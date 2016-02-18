import BatchSender from './corsBatchSender';
import { assign, forEach, omit } from './util';
import uuid from 'uuid';

// The default for max number of errors we will send per session.
// In ALM, a session is started for each page visit.
const DEFAULT_ERROR_LIMIT = 25;

// The default number of lines to keep in error stack traces
const DEFAULT_STACK_LIMIT = 10;

// bookkeeping properties that are set on components being measured
const _currentEventId = '__clientMetricsCurrentEventId__';
const _metricsIdProperty = '__clientMetricsID__';
const WEBSERVICE_SLUG = 'webservice/';

/**
 * Creates a version 4 UUID
 */
const getUniqueId = () => uuid.v4();

/**
 * Massages the AJAX url into a smaller form. Strips away the host and query
 * parameters.
 *
 * Example: http://server/slm/webservice/1.27/Defect.js?foo=bar&baz=buzz
 * becomes 1.27/Defect.js
 * @param url The url to clean up
 */
const getUrl = (url) => {
  if (!url) {
    return "unknown";
  }

  const webserviceIndex = url.indexOf(WEBSERVICE_SLUG);
  let questionIndex;

  if (webserviceIndex !== -1) {
    questionIndex = url.indexOf('?', webserviceIndex);

    if (questionIndex === -1) {
      questionIndex = url.length;
    }

    const skip = WEBSERVICE_SLUG.length;
    return url.substring(webserviceIndex + skip, questionIndex);
  } else {
    questionIndex = url.indexOf('?');

    if (questionIndex === -1) {
      return url;
    }

    return url.substring(0, questionIndex);
  }
};

/**
 * Sets the metrics Id property for the component with a generated uuid
 * @param cmp the component to get an ID for
 */
const getComponentId = (cmp) => {
  if (!cmp[_metricsIdProperty]) {
    cmp[_metricsIdProperty] = getUniqueId();
  }

  return cmp[_metricsIdProperty];
};

/**
 * Finds the RallyRequestId, if any, in the response sent back from the server
 * @param response the response that came back from an Ajax request
 */
export const getRallyRequestId = (response) => {
  const headerName = 'RallyRequestID';

  if (response) {
    if (typeof response === 'string') {
      return response;
    } else if (response.responseHeaders && response.responseHeaders.RallyRequestID) {
      return response.responseHeaders.RallyRequestID;
    } else if (typeof response.getResponseHeader === 'function') {
      return response.getResponseHeader(headerName);
    } else if (response.getResponseHeader && response.getResponseHeader[headerName]) {
      return response.getResponseHeader[headerName];
    } else if (typeof response.headers === 'function') {
      // support for Angular, which does not expose a standard XHR object
      return response.headers(headerName);
    }
  }
};

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
class Aggregator {
  constructor(config) {
    assign(this, config);
    this._pendingEvents = [];
    this._browserTabId = getUniqueId();
    this._startingTime = Date.now();
    this._loadedComponents = [];
    this._allowMultipleComponentReady = false;

    // keep track of how many errors we have reported on, so we
    // can stop after a while and not flood the beacon
    this._errorCount = 0;
    this.errorLimit = this.errorLimit || DEFAULT_ERROR_LIMIT;
    this.stackLimit = this.stackLimit || DEFAULT_STACK_LIMIT;

    this.handlers = this.handlers || [];

    this.sender = this.sender || new BatchSender({
      keysToIgnore: [ 'cmp', 'component' ],
      beaconUrl: config.beaconUrl,
      disableSending: config.disableSending
    });

    if (typeof this.sender.getMaxLength === 'function') {
      this.maxErrorLength = Math.floor(this.sender.getMaxLength() * 0.9);
    }

    if (this.flushInterval) {
      this._flushIntervalId = window.setInterval(() => this.sendAllRemainingEvents(), this.flushInterval);
    }
  }

  /**
   * @public
   */
  destroy() {
    if (this._flushIntervalId) {
      window.clearInterval(this._flushIntervalId);
    }
  }

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
  startSession(status, defaultParams) {
    if (arguments.length < 2) {
      defaultParams = status;
    }
    this._pendingEvents = [];
    if (defaultParams && defaultParams.sessionStart) {
      this._startingTime = defaultParams.sessionStart;
    }
    this._sessionStartTime = this.getRelativeTime();
    this.sendAllRemainingEvents();
    this._defaultParams = omit(defaultParams, 'sessionStart');

    this._errorCount = 0;
    this._loadedComponents = [];
  }

  /**
   * Handles the action client metrics message. Starts and completes a client metric event
   */
  recordAction(options) {
    this._allowMultipleComponentReady = !!options.allowMultipleComponentReady;

    const cmp = options.component;
    delete options.component;
    const traceId = getUniqueId();
    const startTime = this.getRelativeTime(options.startTime);

    const action = this._startEvent(assign({
      eType: 'action',
      cmp: cmp,
      cmpH: options.hierarchy || this._getHierarchyString(cmp),
      eDesc: options.description,
      cmpId: getComponentId(cmp),
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
  }

  recordError(e, miscData = {}) {
    let error;
    if (typeof e === 'string') {
      error = e;
    } else {
      error = e.message;
    }
    error = error.substring(0, this.maxErrorLength || Infinity);
    const stack = e.stack ? e.stack.split('\n').slice(0, this.stackLimit).join('\n') : miscData.stack;
    const traceId = this._currentTraceId;

    if (traceId && this._errorCount < this.errorLimit) {
      ++this._errorCount;

      const startTime = this.getRelativeTime();

      const errorEvent = this._startEvent(assign({}, miscData, {
        error,
        stack,
        eType: 'error',
        eId: getUniqueId(),
        tId: traceId,
        start: startTime,
        stop: startTime
      }));

      this._finishEvent(errorEvent);

      // dont want errors to get left behind in the batch, force it to be sent now
      this.sendAllRemainingEvents();
    }
  }

  recordComponentReady(options) {
    if (typeof this._sessionStartTime === 'undefined') {
      return;
    }

    const traceId = this._currentTraceId;
    const cmp = options.component;
    const cmpHierarchy = options.hierarchy || this._getHierarchyString(cmp);

    if (!this._allowMultipleComponentReady) {
      const seenThisComponentAlready = this._loadedComponents.indexOf(cmpHierarchy) > -1;

      if (seenThisComponentAlready) {
        return;
      }

      this._loadedComponents.push(cmpHierarchy);
    }

    const cmpReadyEvent = this._startEvent(assign({}, options.miscData, {
      eType: 'load',
      start: this._sessionStartTime,
      stop: this.getRelativeTime(options.stopTime),
      eId: getUniqueId(),
      tId: traceId,
      pId: traceId,
      cmpType: options.name || this.getComponentType(cmp),
      cmpH: cmpHierarchy,
      eDesc: 'component ready',
      componentReady: true
    }));

    this._finishEvent(cmpReadyEvent);
  }

  /**
   * Starts a span and returns an object with the data and a
   * function to call to end and record the span. Spans that are not
   * yet ended when a new action is recorded will be dropped.
   * @param {Object} options Information to add to the span
   * @param {Object} options.component The component recording the span
   * @param {String} options.description The description of the load
   * @param {String} [options.hierarchy] The component hierarchy
   * @param {String} [options.name] The name of the component. If not passed, will attempt to determine the name
   * @param {String} [options.type = 'load'] The type of span. One of 'load' or 'dataRequest'
   * @param {Number} [options.startTime = Date.now()] The start time of the span
   * @param {Object} [options.miscData] Any other data that should be recorded with the span
   */
  startSpan(options) {
    const cmp = options.component;
    const traceId = this._currentTraceId;

    if (!traceId) {
      return;
    }

    const startTime = this.getRelativeTime(options.startTime);
    const eventId = getUniqueId();
    const event = assign({}, options.miscData, {
      eType: options.type || 'load',
      cmp: cmp,
      cmpH: options.hierarchy || this._getHierarchyString(cmp),
      eId: eventId,
      cmpType: options.name || this.getComponentType(cmp),
      tId: traceId,
      pId: options.pId || traceId,
      start: startTime
    });

    if (options.description) {
      event.eDesc = options.description;
    }
    const data = this._startEvent(event);
    return {
      data,
      end: (options) => {
        options = options || {};
        options.stop = this.getRelativeTime(options.stopTime);

        if (this._shouldRecordEvent(data, options)) {
          const newEventData = assign({ status: 'Ready' }, omit(options, 'stopTime'));
          this._finishEvent(data, newEventData);
        }
      }
    };
  }

  /**
   * Starts a span of type "load", tracked on the passed-in component.
   * Calling "endLoad" with the same component will record the span
   * @param {Object} options Information to add to the event
   * @param {Object} options.component The component recording the event
   * @param {Number} [options.startTime = Date.now()] The start time of the event
   * @param {String} options.description The description of the load
   * @param {Object} [options.miscData] Any other data that should be recorded with the event
   */
  beginLoad(options) {
    const cmp = options.component;
    const traceId = this._currentTraceId;

    if (!traceId) {
      return;
    }

    if (cmp[_currentEventId + 'load']) {
      // already an in flight load event, so going to bail on this one
      return;
    }

    const startTime = this.getRelativeTime(options.startTime);

  const eventId = getUniqueId();
    cmp[_currentEventId + 'load'] = eventId;

    const event = assign({}, options.miscData, {
      eType: 'load',
      cmp: cmp,
      cmpH: this._getHierarchyString(cmp),
      eDesc: options.description,
      cmpId: getComponentId(cmp),
      eId: eventId,
      cmpType: this.getComponentType(cmp),
      tId: traceId,
      pId: this._findParentId(cmp, traceId),
      start: startTime
    });
    this._startEvent(event);
  }

  /**
   * Handles the endLoad client metrics message. Finishes an event
   * @param {Object} options Information to add to the event
   * @param {Object} options.component The component recording the event
   * @param {Number} [options.stopTime = Date.now()] The stop time of the event
   * @param {Number} [options.whenLongerThan] If specified, the event will be dropped if it did not take longer than
   * this value. Specified in milliseconds.
   */
  endLoad(options) {
    const cmp = options.component;

    const eventId = cmp[_currentEventId + 'load'];

    if (!eventId) {
      // load end found without a load begin, not much can be done with it
      return;
    }

    delete cmp[_currentEventId + 'load'];

    const event = this._findPendingEvent(eventId);

    if (!event) {
      // if we didn't find a pending event, then the load begin happened before the
      // aggregator was ready or a new session was started. Since this load is beyond the scope of the aggregator,
      // just ignoring it.
      return;
    }

    options.stop = this.getRelativeTime(options.stopTime);

    if (this._shouldRecordEvent(event, options)) {
      const newEventData = assign({ status: 'Ready' }, omit(options, 'stopTime'));
      this._finishEvent(event, newEventData);
    }
  }

  /**
   * Handler for before Ajax requests go out. Starts an event for the request,
   *
   * returns an object containting requestId and xhrHeaders
   *  -- requestId should be fed back into endDataRequest to associate the two calls
   *  -- xhrHeaders contains headers that should be added to the AJAX data request
   *
   * returns undefined if the data request could not be instrumented
   */
  beginDataRequest(requester, url, miscData) {
    let options, metricsData;
    if (arguments.length === 1) {
      options = arguments[0];
      requester = options.requester;
      url = options.url;
      miscData = options.miscData;
    }

    const traceId = this._currentTraceId;

    if (requester && traceId) {
      const eventId = getUniqueId();
      const parentId = this._findParentId(requester, traceId);
      const ajaxRequestId = getUniqueId();
      requester[_currentEventId + 'dataRequest' + ajaxRequestId] = eventId;

      this._startEvent(assign({}, miscData, {
        eType: 'dataRequest',
        cmp: requester,
        cmpH: this._getHierarchyString(requester),
        url: getUrl(url),
        cmpType: this.getComponentType(requester),
        cmpId: getComponentId(requester),
        eId: eventId,
        tId: traceId,
        pId: parentId
      }, miscData));

      // NOTE: this looks wrong, but it's not. :)
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
  }

  /**
   * handler for after the Ajax request has finished. Finishes an event for the data request
   */
  endDataRequest(requester, xhr, requestId) {
    let options;

    if (arguments.length === 1) {
      options = arguments[0];
      requester = options.requester;
      xhr = options.xhr;
      requestId = options.requestId;
    }

    if (requester) {
      const eventId = requester[_currentEventId + 'dataRequest' + requestId];

      const event = this._findPendingEvent(eventId);
      if (!event) {
        // if we didn't find a pending event, then the request started before the
        // aggregator was ready or a new session was started. Since this load is beyond the scope of the aggregator,
        // just ignoring it.
        return;
      }

      const newEventData = {
        status: 'Ready',
        stop: this.getRelativeTime()
      };
      const rallyRequestId = getRallyRequestId(xhr);

      if (rallyRequestId) {
        newEventData.rallyRequestId = rallyRequestId;
      }

      this._finishEvent(event, newEventData);
    }
  }

  /**
   * Causes the sender to purge all events it may still have in its queue.
   * Typically done when the user navigates somewhere
   */
  sendAllRemainingEvents() {
    this.sender.flush();
  }

  getComponentType(cmp) {
    return this._getFromHandlers(cmp.singleton || cmp, 'getComponentType');
  }

  getDefaultParams() {
    return this._defaultParams;
  }

  getSessionStartTime() {
    return this._sessionStartTime;
  }

  /**
   * Add a handler
   * @param {Object} handler The new handler
   * @param {Number} index The index to insert the new handler in the handlers collection.
   * If not specified it will be added to the end.
   * @public
   */
  addHandler(handler, index) {
    const insertIndex = arguments.length === 2 ? index : this.handlers.length;
    this.handlers.splice(insertIndex, 0, handler);
  }

  /**
   * Gets the current timestamp relative to the session starting time
   * @param {Number} [timestamp] Timestamp to be converted or falsy to be now
   * @private
   */
  getRelativeTime(timestamp) {
    return (timestamp || Date.now()) - this._startingTime;
  }

  /**
   * Converts timestamp to not be relative to the session starting time
   * @param {Number} timestamp Timestamp to be converted
   * @private
   */
  getUnrelativeTime(timestamp) {
    return timestamp + this._startingTime;
  }

  /**
   * Finishes an event object by completing necessary event properties
   * Adds this event object to the finished event queue
   * Sends finished events before clearing the finished events queue
   * @param existingEvent the event object that has started
   * @param newEventData an object with event properties to append if
   * it doesn't already exist on the event
   * @private
   */
  _finishEvent(existingEvent, newEventData) {
    const event = assign({}, existingEvent, newEventData);
    this._pendingEvents = this._pendingEvents.filter(ev => ev !== existingEvent);

    this.sender.send(event);
  }

  /**
   * Starts an event object by completing necessary event properties
   * Adds this new event object to the pending and current parent event queue
   * @param event the event object with event properties
   * @private
   */
  _startEvent(event) {
    event.tabId = this._browserTabId;

    if (!event.start) {
      event.start = this.getRelativeTime();
    }
    event.bts = this.getUnrelativeTime(event.start);

    if (event.cmp) {
      const appName = this._getFromHandlers(event.cmp, 'getAppName');

      if (appName) {
        event.appName = appName;
      }
    }
    this._pendingEvents.push(assign(event, this._defaultParams));

    return event;
  }

  /**
   * Determines which handler (Ext4/Legacy Dashboard) to use for the requested method
   * @param cmp the component parameter used for the handler's method
   * @param methodName the method being requested
   * @private
   */
  _getFromHandlers(cmp, methodName) {
    let result = null;

    forEach(this.handlers, (handler) => {
      result = handler[methodName](cmp);
      return !result;
    });

    return result;
  }

  /**
   * Finds the parent's event ID
   * @param sourceCmp the component to get the parent's event ID for
   * @private
   */
  _findParentId(sourceCmp, traceId) {
    const hierarchy = this._getHierarchy(sourceCmp);
    let eventId = traceId;

    forEach(hierarchy, (cmp) => {
      const parentEvent = this._findLastEvent((event) => {
        return event.eType !== 'dataRequest' && (event.cmp === cmp || event.cmp === sourceCmp) && event.tId === traceId;
      });
      if (parentEvent) {
        eventId = parentEvent.eId;
        return false;
      }
    });

    return eventId;
  }

  _getHierarchy(cmp) {
    let cmpType = this.getComponentType(cmp);
    const hierarchy = [];

    while (cmpType) {
      hierarchy.push(cmp);
      cmp = cmp.clientMetricsParent || cmp.ownerCt || cmp.owner || (cmp.initialConfig && cmp.initialConfig.owner);
      cmpType = cmp && this.getComponentType(cmp);
    }

    return hierarchy;
  }

  _getHierarchyString(cmp) {
    const hierarchy = this._getHierarchy(cmp);

    if (hierarchy.length === 0) {
      return 'none';
    }

    return hierarchy.map(c => this.getComponentType(c)).join(':');
  }

  /**
   * Finds an event withing the pending events queue if one exists
   * @param eventId the event's ID used to find a match within the pending events
   * @private
   */
  _findPendingEvent(eventId) {
    for (let i = 0; i < this._pendingEvents.length; i++) {
      const ev = this._pendingEvents[i];
      if (ev.eId === eventId) {
        return ev;
      }
    }
    return null;
  }

  _findLastEvent(predicate) {
    for (let i = this._pendingEvents.length - 1; i >= 0; i--) {
      const ev = this._pendingEvents[i];
      if (predicate(ev)) {
        return ev;
      }
    }
    return null;
  }

  _shouldRecordEvent(existingEvent, options) {
    if (options.whenLongerThan && (options.stop - existingEvent.start) <= options.whenLongerThan) {
        this._pendingEvents = this._pendingEvents.filter(ev => ev !== existingEvent);
        return false;
    }

    return true;
  }
}

export default Aggregator;
