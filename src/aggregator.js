var _ = require('underscore');
var BatchSender = require('./corsBatchSender');
var uuid = require('node-uuid');

// The default for max number of errors we will send per session.
// In ALM, a session is started for each page visit.
var DEFAULT_ERROR_LIMIT = 25;

// bookkeeping properties that are set on components being measured
var _currentEventId = '__clientMetricsCurrentEventId__';
var _metricsIdProperty = '__clientMetricsID__';

/**
 * An aggregator that listens to all client metric related messages that go out on
 * the message bus and creates a cohesive picture of what is happening, then pushes
 * this data out to an endpoint which collects the data for analysis
 *
 * ##Aggregator specific terminology##
 *
 * * **event:** A distinct, measurable thing that the page did or the user invoked. For example, clicking on a button,
 * a panel loading, or a grid resorting are all events
 * * **handler:** A helper object that helps the aggregator identify where events came from.
 * * **status:** What was the ultimate fate of an event? If a panel fully loads and becomes fully usable, the event associated
 * with the panel load will have the status of "Ready". If the user navigates away from the page before the panel
 * finishes loading, the associated event's conclusion will be "Navigation". Current conclusion values are:
 *     - Ready: the event concluded normally
 *     - Navigation: the user navigated away before the event could complete
 *     - Timeout: (Not yet implemented), indicates a load event took too long
 *
 *
 *  NOTE: Most properties are short acronyms:
 *  * bts -- browser time stamp
 *  * tabId -- the browser tab ID
 *  * tId -- trace ID
 *  * eId -- event ID
 *  * pId -- parent ID
 *  * eType -- event type (ie load, action or dataRequest)
 *  * eDesc -- event description
 *  * cmpType -- component type
 *  * cmpId -- component ID
 *  * uId -- user id
 *  * sId -- subscription id
 *
 * @constructor
 * @param {Object} config Configuration object
 * @param {Object[]} [config.ajaxProviders] Ajax providers that emit the following events:
 *   * beforerequest - When an Ajax request is about to be made
 *   * requestcomplete - When an Ajax request has finished
 * @param {Object} [config.sender = BatchSender] Which sender to use. By default,
 *   a BatchSender will be used.
 * @param {Number} [config.flushInterval] If defined, events will be sent at least that often.
 * @param {String} [config.beaconUrl = "https://trust.f4tech.com/beacon/"] URL where the beacon is located.
 */
var Aggregator = function(config) {
    _.extend(this, config);

    this._pendingEvents = [];
    this._browserTabId = this._getUniqueId();
    this._startingTime = new Date().getTime();
    this._loadedComponents = [];

    // keep track of how many errors we have reported on, so we
    // can stop after a while and not flood the beacon
    this._errorCount = 0;
    this.errorLimit = this.errorLimit || DEFAULT_ERROR_LIMIT;

    this.handlers = this.handlers || [];

    this.sender = this.sender || new BatchSender({
        keysToIgnore: [ 'cmp', 'component' ],
        beaconUrl: config.beaconUrl,
        disableSending: config.disableSending
    });

    if (_.isFunction(this.sender.getMaxLength)) {
        this.maxErrorLength = Math.floor(this.sender.getMaxLength() * 0.9);
    }

    if (_.isNumber(this.flushInterval)) {
        this._flushIntervalId = window.setInterval(_.bind(this.sendAllRemainingEvents, this), this.flushInterval);
    }
};

/**
 * @public
 */
Aggregator.prototype.destroy = function() {
    if (this._flushIntervalId) {
        window.clearInterval(this._flushIntervalId);
    }
};

/**
 * Handles the starting of a new "session"
 * Finishes and sends off pending events with a Navigation status
 * Resets current parent events queue, starting time, and current hash
 * Calls a new navigation user action
 * @param status the event's status for each of the pending events
 * @param defaultParams Default parameters that are sent with each request
 * @param defaultParams.sessionStart start time for this session - defaults
 *   to now, but can be set if actual start is before library is initialized
 * @public
 */
Aggregator.prototype.startSession = function(status, defaultParams) {
    this._pendingEvents = [];
    if (defaultParams && defaultParams.sessionStart) {
        this._startingTime = defaultParams.sessionStart;
        delete defaultParams.sessionStart;
    }
    this._sessionStartTime = this.getRelativeTime();
    this.sendAllRemainingEvents();
    this._defaultParams = defaultParams;

    this._errorCount = 0;
    this._loadedComponents = [];
};

/**
 * Handles the action client metrics message. Starts and completes a client metric event
 */
Aggregator.prototype.recordAction = function(options) {
    var cmp = options.component;
    delete options.component;
    var traceId = this._getUniqueId();
    var startTime = this.getRelativeTime(options.startTime);

    var action = this._startEvent(_.defaults({
        eType: 'action',
        cmp: cmp,
        cmpH: options.hierarchy || this._getHierarchyString(cmp),
        eDesc: options.description,
        cmpId: this._getComponentId(cmp),
        eId: traceId,
        tId: traceId,
        status: 'Ready',
        cmpType: options.name || this.getComponentType(cmp),
        start: startTime,
        stop: startTime
    }, options.miscData));

    this._currentTraceId = traceId;
    this._finishEvent(action);

    return traceId;
};

Aggregator.prototype.recordError = function(errorInfo, miscData) {
    var options, traceId;
    if (_.isObject(errorInfo) && errorInfo.errorInfo) {
        options = errorInfo;
        errorInfo = options.errorInfo;
        miscData = options.miscData;
        traceId = options.traceId;
    }

    traceId = traceId || this._currentTraceId;

    if (traceId && this._errorCount < this.errorLimit) {
        ++this._errorCount;

        var errorMsg = errorInfo || 'unknown error';
        if (this.maxErrorLength) {
            errorMsg = errorMsg.substring(0, this.maxErrorLength);
        }

        var startTime = this.getRelativeTime();

        var errorEvent = this._startEvent(_.defaults({
            eType: 'error',
            error: errorMsg,
            eId: this._getUniqueId(),
            tId: traceId,
            start: startTime,
            stop: startTime
        }, miscData));

        this._finishEvent(errorEvent);

        // dont want errors to get left behind in the batch, force it to be sent now
        this.sendAllRemainingEvents();
    }
};

Aggregator.prototype.recordComponentReady = function(options) {
    if (_.isUndefined(this._sessionStartTime)) {
        return;
    }

    var traceId = options.traceId || this._currentTraceId;
    var cmp = options.component,
        cmpHierarchy = options.hierarchy || this._getHierarchyString(cmp);

    var seenThisComponentAlready = this._loadedComponents.indexOf(cmpHierarchy) > -1;

    if (seenThisComponentAlready) {
        return;
    }

    this._loadedComponents.push(cmpHierarchy);

    var cmpReadyEvent = this._startEvent(_.defaults({
        eType: 'load',
        start: this._sessionStartTime,
        stop: this.getRelativeTime(options.stopTime),
        eId: this._getUniqueId(),
        tId: traceId,
        pId: traceId,
        cmpType: options.name || this.getComponentType(cmp),
        cmpH: cmpHierarchy,
        eDesc: 'component ready',
        componentReady: true
    }, options.miscData));

    this._finishEvent(cmpReadyEvent);
};

Aggregator.prototype.startSpan = function(options) {
    var aggregator = this;
    var cmp = options.component;
    var traceId = options.traceId || this._currentTraceId;

    if (!traceId) {
        return;
    }

    var startTime = this.getRelativeTime(options.startTime);

    var eventId = this._getUniqueId();

    var event = _.defaults({
        eType: options.type || 'load',
        cmp: cmp,
        cmpH: options.hierarchy || this._getHierarchyString(cmp),
        eId: eventId,
        cmpType: options.name || this.getComponentType(cmp),
        tId: traceId,
        pId: options.pId || traceId,
        start: startTime
    }, options.miscData);
    if (options.description) {
      event.eDesc = options.description;
    }
    return {
      data: this._startEvent(event),
      end: function(options) {
          options = options || {};
          options.stop = aggregator.getRelativeTime(options.stopTime);

          if (aggregator._shouldRecordEvent(this.data, options)) {
              aggregator._finishEvent(this.data, _.extend({
                  status: 'Ready'
              }, options));
          }
      }
    };
};

Aggregator.prototype.endSpan = function(options) {
};

/**
 * Handles the beginLoad client metrics message. Starts an event
 * @param {Object} options Information to add to the event
 * @param {Object} options.component The component recording the event
 * @param {Number} [options.startTime = new Date().getTime()] The start time of the event
 * @param {String} options.description The description of the load
 * @param {Object} [options.miscData] Any other data that should be recorded with the event
 */
Aggregator.prototype.beginLoad = function(options) {
    var cmp = options.component;
    var traceId = options.traceId || this._currentTraceId;

    if (!traceId) {
        return;
    }

    if (cmp[_currentEventId + 'load']) {
        // already an in flight load event, so going to bail on this one
        return;
    }

    var startTime = this.getRelativeTime(options.startTime);

    var eventId = this._getUniqueId();
    cmp[_currentEventId + 'load'] = eventId;

    var event = _.defaults({
        eType: 'load',
        cmp: cmp,
        cmpH: this._getHierarchyString(cmp),
        eDesc: options.description,
        cmpId: this._getComponentId(cmp),
        eId: eventId,
        cmpType: this.getComponentType(cmp),
        tId: traceId,
        pId: this._findParentId(cmp, traceId),
        start: startTime
    }, options.miscData);
    this._startEvent(event);
};

/**
 * Handles the endLoad client metrics message. Finishes an event
 * @param {Object} options Information to add to the event
 * @param {Object} options.component The component recording the event
 * @param {Number} [options.stopTime = new Date().getTime()] The stop time of the event
 * @param {Number} [options.whenLongerThan] If specified, the event will be dropped if it did not take longer than
 * this value. Specified in milliseconds.
 */
Aggregator.prototype.endLoad = function(options) {
    var cmp = options.component;

    var eventId = cmp[_currentEventId + 'load'];

    if (!eventId) {
        // load end found without a load begin, not much can be done with it
        return;
    }

    delete cmp[_currentEventId + 'load'];

    var event = this._findPendingEvent(eventId);

    if (!event) {
        // if we didn't find a pending event, then the load begin happened before the
        // aggregator was ready or a new session was started. Since this load is beyond the scope of the aggregator,
        // just ignoring it.
        return;
    }

    options.stop = this.getRelativeTime(options.stopTime);

    if (this._shouldRecordEvent(event, options)) {
        this._finishEvent(event, _.extend({
            status: 'Ready'
        }, options));
    }
};

/**
 * Handler for before Ajax requests go out. Starts an event for the request,
 *
 * returns an object containting requestId and xhrHeaders
 *  -- requestId should be fed back into endDataRequest to associate the two calls
 *  -- xhrHeaders contains headers that should be added to the AJAX data request
 *
 * returns undefined if the data request could not be instrumented
 */
Aggregator.prototype.beginDataRequest = function(requester, url, miscData) {
    var options, traceId, metricsData;
    if (arguments.length === 1) {
        options = arguments[0];
        requester = options.requester;
        url = options.url;
        miscData = options.miscData;
        traceId = options.traceId;
    }

    traceId = traceId || this._currentTraceId;

    if (requester && traceId) {
        var eventId = this._getUniqueId();
        var parentId = this._findParentId(requester, traceId);
        var ajaxRequestId = this._getUniqueId();
        requester[_currentEventId + 'dataRequest' + ajaxRequestId] = eventId;

        this._startEvent(_.defaults({
            eType: 'dataRequest',
            cmp: requester,
            cmpH: this._getHierarchyString(requester),
            url: this._getUrl(url),
            cmpType: this.getComponentType(requester),
            cmpId: this._getComponentId(requester),
            eId: eventId,
            tId: traceId,
            pId: parentId
        }, miscData));

        // NOTE: this looks wrong, but it's not
        // This client side dataRequest event is going to be
        // the "parent" of the server side event that responds.
        // So in the request headers, sending the current event Id as
        // the parent Id.
        metricsData = {
            requestId: ajaxRequestId,
            xhrHeaders: {
                'X-Trace-Id': traceId,
                'X-Parent-Id': eventId
            }
        };
    }

    return metricsData;
};

/**
 * handler for after the Ajax request has finished. Finishes an event for the data request
 */
Aggregator.prototype.endDataRequest = function(requester, xhr, requestId) {
    var options;

    if (arguments.length === 1) {
        options = arguments[0];
        requester = options.requester;
        xhr = options.xhr;
        requestId = options.requestId;
    }

    if (requester) {
        var eventId = requester[_currentEventId + 'dataRequest' + requestId];

        var event = this._findPendingEvent(eventId);
        if (!event) {
            // if we didn't find a pending event, then the request started before the
            // aggregator was ready or a new session was started. Since this load is beyond the scope of the aggregator,
            // just ignoring it.
            return;
        }

        var newEventData = {
            status: 'Ready',
            stop: this.getRelativeTime()
        };
        var rallyRequestId = this._getRallyRequestId(xhr);

        if (rallyRequestId) {
            newEventData.rallyRequestId = rallyRequestId;
        }

        this._finishEvent(event, newEventData);
    }
};

/**
 * Causes the sender to purge all events it may still have in its queue.
 * Typically done when the user navigates somewhere
 */
Aggregator.prototype.sendAllRemainingEvents = function() {
    this.sender.flush();
};

Aggregator.prototype.getComponentType = function(cmp) {
    return this._getFromHandlers(cmp.singleton || cmp, 'getComponentType');
};

Aggregator.prototype.getDefaultParams = function() {
    return this._defaultParams;
};

Aggregator.prototype.getSessionStartTime = function() {
    return this._sessionStartTime;
};

/**
 * Creates a version 4 UUID
 * @private
 */
Aggregator.prototype._getUniqueId = function() {
    return uuid.v4();
};

/**
 * Gets the current timestamp relative to the starting time
 * @param {Number} timestamp Timestamp to be converted
 * @private
 */
Aggregator.prototype.getRelativeTime = function(timestamp) {
    return (timestamp || new Date().getTime()) - this._startingTime;
};

/**
 * Gets the current timestamp relative to the starting time
 * @param {Number} timestamp Timestamp to be converted
 * @private
 */
Aggregator.prototype.getUnrelativeTime = function(timestamp) {
    return timestamp + this._startingTime;
};

/**
 * Finishes an event object by completing necessary event properties
 * Adds this event object to the finished event queue
 * Sends finished events before clearing the finished events queue
 * @param existingEvent the event object that has started
 * @param newEventData an object with event properties to append if
 * it doesn't already exist on the event
 * @private
 */
Aggregator.prototype._finishEvent = function(existingEvent, newEventData) {
    var event = _.defaults(
        newEventData || {},
        existingEvent,
        this._defaultParams,
        this._guiTestParams
    );

    this._pendingEvents = _.without(this._pendingEvents, existingEvent);

    this.sender.send(event);
};

/**
 * Starts an event object by completing necessary event properties
 * Adds this new event object to the pending and current parent event queue
 * @param event the event object with event properties
 * @private
 */
Aggregator.prototype._startEvent = function(event) {
    event.tabId = this._browserTabId;

    if (!_.isNumber(event.start)) {
        event.start = this.getRelativeTime();
    }
    event.bts = this.getUnrelativeTime(event.start);

    if (event.cmp) {
        var appName = this._getFromHandlers(event.cmp, 'getAppName');

        if (appName) {
            event.appName = appName;
        }
    }

    this._pendingEvents.push(event);

    return event;
};

/**
 * Determines which handler (Ext4/Legacy Dashboard) to use for the requested method
 * @param cmp the component parameter used for the handler's method
 * @param methodName the method being requested
 * @private
 */
Aggregator.prototype._getFromHandlers = function(cmp, methodName) {
    var result = null;

    _.each(this.handlers, function(handler) {
        result = handler[methodName](cmp);
        return !result;
    });

    return result;
};

/**
 * Finds the parent's event ID
 * @param sourceCmp the component to get the parent's event ID for
 * @private
 */
Aggregator.prototype._findParentId = function(sourceCmp, traceId) {
    var hierarchy = this._getHierarchy(sourceCmp);
    var eventId = traceId;

    _.each(hierarchy, function(cmp) {
        var parentEvent = _.findLast(this._pendingEvents, function(event) {
            return event.eType !== 'dataRequest' && (event.cmp === cmp || event.cmp === sourceCmp) && event.tId === traceId;
        });
        if (parentEvent) {
            eventId = parentEvent.eId;
            return false;
        }
    }, this);

    return eventId;
};

/**
 * Sets the metrics Id property for the component with a generated uuid
 * @param cmp the component to get an ID for
 * @private
 */
Aggregator.prototype._getComponentId = function(cmp) {
    if (!cmp[_metricsIdProperty]) {
        cmp[_metricsIdProperty] = this._getUniqueId();
    }

    return cmp[_metricsIdProperty];
};

Aggregator.prototype._getHierarchy = function(cmp) {
    var cmpType = this.getComponentType(cmp);
    var hierarchy = [];

    while (cmpType) {
        hierarchy.push(cmp);
        cmp = cmp.clientMetricsParent || cmp.ownerCt || cmp.owner || (cmp.initialConfig && cmp.initialConfig.owner);
        cmpType = cmp && this.getComponentType(cmp);
    }

    return hierarchy;
};

Aggregator.prototype._getHierarchyString = function(cmp) {
    var hierarchy = this._getHierarchy(cmp);

    if (hierarchy.length === 0) {
        return 'none';
    }

    return _.map(hierarchy, function(c) {
      return this.getComponentType(c);
    }, this).join(':');
};

/**
 * Massages the AJAX url into a smaller form. Strips away the host and query
 * parameters.
 *
 * Example: http://server/slm/webservice/1.27/Defect.js?foo=bar&baz=buzz
 * becomes 1.27/Defect.js
 * @param url The url to clean up
 * @private
 */
Aggregator.prototype._getUrl = function(url) {
    if (!url) {
        return "unknown";
    }

    var webserviceSlug = 'webservice/';
    var webserviceIndex = url.indexOf(webserviceSlug);
    var questionIndex;

    if (webserviceIndex > -1) {
        questionIndex = url.indexOf('?', webserviceIndex);

        if (questionIndex < 0) {
            questionIndex = url.length;
        }

        var skip = webserviceSlug.length;
        return url.substring(webserviceIndex + skip, questionIndex);
    } else {
        questionIndex = url.indexOf('?');

        if (questionIndex < 0) {
            return url;
        }

        return url.substring(0, questionIndex);
    }
};

/**
 * Finds the RallyRequestId, if any, in the response sent back from the server
 * @param response the response that came back from an Ajax request
 * @private
 */
Aggregator.prototype._getRallyRequestId = function(response) {
    var headerName = 'RallyRequestID';

    if (response) {
        if (_.isString(response)) {
            return response;

        } else if (_.isObject(response.responseHeaders)) {
            return response.responseHeaders.RallyRequestID;

        } else if (_.isFunction(response.getResponseHeader)) {
            return response.getResponseHeader(headerName);

        } else if (_.isObject(response.getResponseHeader)) {
            return response.getResponseHeader[headerName];

        } else if (_.isFunction(response.headers)) {
            // support for Angular, which does not expose a standard XHR object
            return response.headers(headerName);
        }
    }
};

/**
 * Finds an event withing the pending events queue if one exists
 * @param eventId the event's ID used to find a match within the pending events
 * @private
 */
Aggregator.prototype._findPendingEvent = function(eventId) {
    return _.find(this._pendingEvents, {eId: eventId});
};

Aggregator.prototype._shouldRecordEvent = function(existingEvent, options) {
    if (options.whenLongerThan && (options.stop - existingEvent.start) <= options.whenLongerThan) {
        this._pendingEvents = _.without(this._pendingEvents, existingEvent);
        return false;
    }

    return true;
};

module.exports = Aggregator;
