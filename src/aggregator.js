// @ts-check
/**
 * @module
 */
import uuidV4 from 'uuid/v4';
import BatchSender from './corsBatchSender';
import { assign, forEach, omit } from './util';

// The default for max number of errors we will send per session.
const DEFAULT_ERROR_LIMIT = 25;

// The default number of lines to keep in error stack traces
const DEFAULT_STACK_LIMIT = 20;

// bookkeeping properties that are set on components being measured
const currentEventId = '__clientMetricsCurrentEventId__';
const metricsIdProperty = '__clientMetricsID__';
const WEBSERVICE_SLUG = 'webservice/';

/**
 * Creates a version 4 UUID
 * @private
 */
const getUniqueId = () => uuidV4();

/**
 * Massages the AJAX url into a smaller form. Strips away the host and query
 * parameters.
 *
 * Example: http://server/slm/webservice/1.27/Defect.js?foo=bar&baz=buzz
 * becomes 1.27/Defect.js
 * @param url The url to clean up
 * @private
 */
const getUrl = url => {
  if (!url) {
    return 'unknown';
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
  }
  questionIndex = url.indexOf('?');

  if (questionIndex === -1) {
    return url;
  }

  return url.substring(0, questionIndex);
};

/**
 * Sets the metrics Id property for the component with a generated uuid
 * @param cmp the component to get an ID for
 * @private
 */
const getComponentId = cmp => {
  if (!cmp[metricsIdProperty]) {
    cmp[metricsIdProperty] = getUniqueId(); // eslint-disable-line no-param-reassign
  }

  return cmp[metricsIdProperty];
};

/**
 * Finds the RallyRequestId, if any, in the response sent back from the server
 * @param response the response that came back from an Ajax request
 * @private
 */
export const getRallyRequestId = response => {
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
  return null;
};

/**
 * An aggregator that exposes methods to record client metrics and send the data
 * to an endpoint which collects the data for analysis
 *
 * ## Aggregator specific terminology
 *
 * * **event:** A distinct, measurable thing that the page did or the user invoked.
 *     For example, clicking on a button, a panel loading, or a grid resorting are all events
 * * **handler:** A helper object that helps the aggregator identify where events came from.
 * * **status:** What was the ultimate fate of an event? If a panel fully loads and becomes
 *     fully usable, the event associated with the panel load will have the status of "Ready".
 *     If the user navigates away from the page before the panel finishes loading, the associated
 *     event's conclusion will be "Navigation". Current conclusion values are:
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
 * @param {String} [config.beaconUrl] Beacon URL where client metrics should be sent.
 * @param {Boolean} [config.disableSending=false] Set to true to disable sending
 *   client metrics to the beacon
 * @param {Number} [config.errorLimit=25] The max number of errors to report per session. When this
 *   amount is exceeded, recorded errors are dropped.
 * @param {Number} [config.flushInterval] If defined, events will be sent at least that often.
 * @param {Regexp} [config.ignoreStackMatcher] Regular expression that, if provided, will remove
 *   matching lines from stack traces when recording JS errors.
 *   For example to ignore stack lines from within React:
 *   `ignoreStackMatcher = /(getNativeNode|updateChildren|updateComponent|receiveComponent)/`
 * @param {Object} [config.sender = BatchSender] Which sender to use. By default,
 *   a BatchSender will be used.
 * @param {Number} [config.stackLimit=50] The number of lines to keep in error stack traces
 */
class Aggregator {
  constructor(config = {}) {
    this.sendAllRemainingEvents = this.sendAllRemainingEvents.bind(this);
    this._onSend = this._onSend.bind(this);
    this._flushInterval = config.flushInterval;
    this._ignoreStackMatcher = config.ignoreStackMatcher;
    this._actionStartTime = null;
    this._pendingEvents = [];
    this._browserTabId = getUniqueId();
    this._startingTime = Date.now();
    this._currentTraceId = null;

    // keep track of how many errors we have reported on, so we
    // can stop after a while and not flood the beacon
    this._errorCount = 0;
    this._errorLimit = config.errorLimit || DEFAULT_ERROR_LIMIT;
    this._stackLimit = config.stackLimit || DEFAULT_STACK_LIMIT;

    this.handlers = config.handlers || [];

    this.sender =
      config.sender ||
      new BatchSender({
        keysToIgnore: ['cmp', 'component'],
        beaconUrl: config.beaconUrl,
        disableSending: config.disableSending,
        onSend: this._onSend,
      });

    if (typeof this.sender.getMaxLength === 'function') {
      this.maxErrorLength = Math.floor(this.sender.getMaxLength() * 0.9);
    }

    this._setInterval();
  }

  /**
   * Destroys and cleans up the aggregator. If a flushInterval was provided, that will stop.
   * @public
   */
  destroy() {
    this._clearInterval();
  }

  /**
   * Drops any unfinshed events on the floor and resets the error count. Allows different
   * default params to be included with each event sent after this call completes.
   * Any events that have not been sent to the beacon will be sent at this time.
   * @param {Object} [defaultParams={}] Key/Value pairs of parameters that will be included
   *   with each event
   * @param {Number} [defaultParams.sessionStart] start time for this session - defaults
   *   to now, but can be set if actual start is before library is initialized. For example,
   *   if you'd like to back-date the session start time to when the full page started loading,
   *   before the library has been loaded, you might supply that value.
   * @public
   */
  startSession(_deprecated_, defaultParams = {}) {
    if (arguments.length === 1) {
      defaultParams = _deprecated_ || {}; // eslint-disable-line no-param-reassign
    }
    this._pendingEvents = [];
    if (defaultParams && defaultParams.sessionStart) {
      this._startingTime = defaultParams.sessionStart;
    }
    this.sendAllRemainingEvents();
    this._defaultParams = omit(defaultParams, ['sessionStart']);

    this._errorCount = 0;
    this._actionStartTime = null;
  }

  /**
   * Starts a new trace and records an event of type _action_. The new trace ID will also be
   * this event's ID.
   * @param {Object} options
   * @param {String} options.hierarchy The component hierarchy. This can be whatever format works
   *   for your beacon. An example format is `component:parent_component:grandparent_component`.
   *   Populates the `cmpH` field
   * @param {String} options.description The name of the event. Example: `submitted login form`.
   *   Populates the `eDesc` field
   * @param {String} options.name The name of the component. Populates the `cmpType` field
   * @param {Number} [options.startTime=now] When this action happened. Usually, you won't
   *   provide a value here and the library will use the time of this function call.
   * @param {Object} [options.miscData] Key/Value pairs for any other fields you would like
   *   added to the event.
   */
  recordAction(options) {
    const cmp = options.component;
    const traceId = getUniqueId();
    this._actionStartTime = this.getRelativeTime(options.startTime);

    const action = this._startEvent(
      assign(
        {
          eType: 'action',
          cmp,
          cmpH: options.hierarchy || this._getHierarchyString(cmp),
          eDesc: options.description,
          cmpId: getComponentId(cmp),
          eId: traceId,
          tId: traceId,
          status: 'Ready',
          cmpType: options.name || this.getComponentType(cmp),
          start: this._actionStartTime,
          stop: this._actionStartTime,
        },
        options.miscData
      )
    );

    this._currentTraceId = traceId;
    this._finishEvent(action);

    return traceId;
  }

  /**
   * Records an event of type _error_.
  * Any events that have not been sent to the beacon will be sent at this time.
   * @param {Error|String} e The Error object or string message.
   * @param {Object} [miscData={}] Key/Value pairs for any other fields you would like
   *   added to the event.
   */
  recordError(e, miscData = {}) {
    let error;
    if (typeof e === 'string') {
      error = e;
    } else {
      error = e.message;
    }
    error = error.substring(0, this.maxErrorLength || Infinity);
    const stack = this._getFilteredStackTrace(e, miscData);
    const traceId = this._currentTraceId;

    if (traceId && this._errorCount < this._errorLimit) {
      this._errorCount += 1;

      const startTime = this.getRelativeTime();

      const errorEvent = this._startEvent(
        assign({}, miscData, {
          error,
          stack,
          eType: 'error',
          eId: getUniqueId(),
          tId: traceId,
          start: startTime,
          stop: startTime,
        })
      );

      this._finishEvent(errorEvent);

      // dont want errors to get left behind in the batch, force it to be sent now
      this.sendAllRemainingEvents();
    }
  }

  /**
   * Records an event of type _load_ with `eDesc`=`component ready`. The `start` field will
   *   have the same value as the last action's start value. The `componentReady` field will
   *   be set to `true`.
   *
   * This function is useful for logging importing point-in-time events, like when a component is
   * fully loaded. This event will be given a duration so that you can see how long it took
   * to become ready since the user/system action was performed. A useful scenario is for
   * recording when React containers have finished loading.
   *
   * @param {Object} options
   * @param {String} options.hierarchy The component hierarchy. This can be whatever format works
   *   for your beacon. An example format is `component:parent_component:grandparent_component`.
   *   Populates the `cmpH` field
   * @param {String} options.description The name of the event. Example: `submitted login form`.
   *   Populates the `eDesc` field
   * @param {String} options.name The name of the component. Populates the `cmpType` field
   * @param {Number} [options.stopTime=now] When this component ready really happened.
   *   Usually, you won't provide a value here and the library will use the time of this function
   *   call. Populates the `stop` field.
   * @param {Object} [options.miscData] Key/Value pairs for any other fields you would like
   *   added to the event.
   */
  recordComponentReady(options) {
    if (this._actionStartTime === null) {
      return;
    }

    const traceId = this._currentTraceId;
    const cmp = options.component;
    const cmpHierarchy = options.hierarchy || this._getHierarchyString(cmp);

    const cmpReadyEvent = this._startEvent(
      assign({}, options.miscData, {
        eType: 'load',
        start: this._actionStartTime,
        stop: this.getRelativeTime(options.stopTime),
        eId: getUniqueId(),
        tId: traceId,
        pId: traceId,
        cmpType: options.name || this.getComponentType(cmp),
        cmpH: cmpHierarchy,
        eDesc: 'component ready',
        componentReady: true,
      })
    );

    this._finishEvent(cmpReadyEvent);
  }

  /**
   * Starts a span (event) and returns an object with the data and a
   * function to call to end and record the span. Spans that are not
   * yet ended when a new action is recorded will be dropped.
   * @param {Object} options Information to add to the span
   * @param {Object} options.component The component recording the span
   * @param {String} options.description The description of the load
   * @param {String} [options.hierarchy] The component hierarchy
   * @param {String} [options.name] The name of the component. If not passed, will attempt to
   *   determine the name
   * @param {String} [options.type = 'load'] The type of span. One of 'load' or 'dataRequest'
   * @param {Number} [options.startTime = Date.now()] The start time of the span
   * @param {Object} [options.miscData] Key/Value pairs for any other fields you would like
   *   added to the event.
   * @returns {Object} Object with the following properties:
   *   * **data**: The created span data
   *   * **end**: A function to call when the span should be ended and sent to the beacon. An
   *     options object can be passed to the `end` function containing key/value pairs to be
   *     included with the event and also a `stopTime` to indicate if the event ended at a
   *     different time than now. It can also include a `whenLongerThan` number to indicate
   *     the number of ms that the event must be longer than or it will not be sent.
   */
  startSpan(options) {
    const cmp = options.component;
    const traceId = this._currentTraceId;

    if (!traceId) {
      return null;
    }

    const startTime = this.getRelativeTime(options.startTime);
    const eventId = getUniqueId();
    const event = assign({}, options.miscData, {
      eType: options.type || 'load',
      cmp,
      cmpH: options.hierarchy || this._getHierarchyString(cmp),
      eId: eventId,
      cmpType: options.name || this.getComponentType(cmp),
      tId: traceId,
      pId: options.pId || traceId,
      start: startTime,
    });

    if (options.description) {
      event.eDesc = options.description;
    }
    const data = this._startEvent(event);
    return {
      data,
      end: (endOptions = {}) => {
        const newEventData = assign(
          {
            status: 'Ready',
            stop: this.getRelativeTime(endOptions.stopTime),
          },
          omit(endOptions, ['stopTime'])
        );
        if (this._shouldRecordEvent(data, newEventData)) {
          this._finishEvent(data, newEventData);
        }
      },
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
   * @deprecated
   */
  beginLoad(options) {
    const cmp = options.component;
    const traceId = this._currentTraceId;

    if (!traceId) {
      return;
    }

    if (cmp[`${currentEventId}load`]) {
      // already an in flight load event, so going to bail on this one
      return;
    }

    const startTime = this.getRelativeTime(options.startTime);

    const eventId = getUniqueId();
    cmp[`${currentEventId}load`] = eventId;

    const event = assign({}, options.miscData, {
      eType: 'load',
      cmp,
      cmpH: this._getHierarchyString(cmp),
      eDesc: options.description,
      cmpId: getComponentId(cmp),
      eId: eventId,
      cmpType: this.getComponentType(cmp),
      tId: traceId,
      pId: this._findParentId(cmp, traceId),
      start: startTime,
    });
    this._startEvent(event);
  }

  /**
   * Handles the endLoad client metrics message. Finishes an event
   * @param {Object} options Information to add to the event
   * @param {Object} options.component The component recording the event
   * @param {Number} [options.stopTime = Date.now()] The stop time of the event
   * @param {Number} [options.whenLongerThan] If specified, the event will be dropped if it did
   *   not take longer than this value. Specified in milliseconds.
   * @deprecated
   */
  endLoad(options) {
    const cmp = options.component;

    const eventId = cmp[`${currentEventId}load`];

    if (!eventId) {
      // load end found without a load begin, not much can be done with it
      return;
    }

    delete cmp[`${currentEventId}load`];

    const event = this._findPendingEvent(eventId);

    if (!event) {
      // if we didn't find a pending event, then the load begin happened before the
      // aggregator was ready or a new session was started. Since this load is beyond the
      // scope of the aggregator, just ignoring it.
      return;
    }

    const newEventData = assign(
      {
        status: 'Ready',
        stop: this.getRelativeTime(options.stopTime),
      },
      omit(options, ['stopTime'])
    );
    if (this._shouldRecordEvent(event, newEventData)) {
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
   * @deprecated
   */
  beginDataRequest(...args) {
    let options;
    let metricsData;
    let requester;
    let url;
    let miscData;
    if (args.length === 1) {
      options = args[0];
      requester = options.requester;
      url = options.url;
      miscData = options.miscData;
    } else {
      [requester, url, miscData] = args;
    }

    const traceId = this._currentTraceId;

    if (requester && traceId) {
      const eventId = getUniqueId();
      const parentId = this._findParentId(requester, traceId);
      const ajaxRequestId = getUniqueId();
      requester[`${currentEventId}dataRequest${ajaxRequestId}`] = eventId;

      this._startEvent(
        assign(
          {},
          miscData,
          {
            eType: 'dataRequest',
            cmp: requester,
            cmpH: this._getHierarchyString(requester),
            url: getUrl(url),
            cmpType: this.getComponentType(requester),
            cmpId: getComponentId(requester),
            eId: eventId,
            tId: traceId,
            pId: parentId,
            start: this.getRelativeTime(),
          },
          miscData
        )
      );

      // NOTE: this looks wrong, but it's not. :)
      // This client side dataRequest event is going to be
      // the "parent" of the server side event that responds.
      // So in the request headers, sending the current event Id as
      // the parent Id.
      metricsData = {
        requestId: ajaxRequestId,
        xhrHeaders: {
          'X-Trace-Id': traceId,
          'X-Parent-Id': eventId,
        },
      };
    }

    return metricsData;
  }

  /**
   * handler for after the Ajax request has finished. Finishes an event for the data request.
   * @deprecated
   */
  endDataRequest(...args) {
    let options;
    let requester;
    let xhr;
    let requestId;
    if (args.length === 1) {
      options = args[0];
      requester = options.requester;
      xhr = options.xhr;
      requestId = options.requestId;
    } else {
      [requester, xhr, requestId] = args;
    }

    if (requester) {
      const eventId = requester[`${currentEventId}dataRequest${requestId}`];

      const event = this._findPendingEvent(eventId);
      if (!event) {
        // if we didn't find a pending event, then the request started before the
        // aggregator was ready or a new session was started. Since this load is beyond the scope
        // of the aggregator, just ignoring it.
        return;
      }

      const newEventData = {
        status: 'Ready',
        stop: this.getRelativeTime(),
      };
      const rallyRequestId = getRallyRequestId(xhr);

      if (rallyRequestId) {
        newEventData.rallyRequestId = rallyRequestId;
      }

      this._finishEvent(event, newEventData);
    }
  }

  /**
   * Causes the batch sender to send all events it still has in its queue.
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

  getCurrentTraceId() {
    return this._currentTraceId;
  }

  /**
   * Add a handler
   * @param {Object} handler The new handler
   * @deprecated
   */
  addHandler(handler) {
    this.handlers.push(handler);
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

  _getFilteredStackTrace(e, miscData = {}) {
    const stackList = (e.stack || miscData.stack || '').split('\n');
    const filteredStack = this._ignoreStackMatcher
      ? stackList.filter(stack => !this._ignoreStackMatcher.test(stack))
      : stackList;
    return filteredStack.slice(0, this._stackLimit).join('\n');
  }

  _clearInterval() {
    if (this._flushIntervalId) {
      window.clearInterval(this._flushIntervalId);
    }
  }

  _setInterval() {
    if (this._flushInterval) {
      this._flushIntervalId = window.setInterval(this.sendAllRemainingEvents, this._flushInterval);
    }
  }

  _onSend() {
    this._clearInterval();
    this._setInterval();
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
    const addlFields = {
      tabId: this._browserTabId,
      bts: this.getUnrelativeTime(event.start),
    };

    if (event.cmp) {
      const appName = this._getFromHandlers(event.cmp, 'getAppName');

      if (appName) {
        addlFields.appName = appName;
      }
    }
    const startedEvent = assign(addlFields, event, this._defaultParams);
    this._pendingEvents.push(startedEvent);

    return startedEvent;
  }

  /**
   * Determines which handler (Ext4/Legacy Dashboard) to use for the requested method
   * @param cmp the component parameter used for the handler's method
   * @param methodName the method being requested
   * @private
   */
  _getFromHandlers(cmp, methodName) {
    let result = null;

    forEach(this.handlers, handler => {
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

    forEach(hierarchy, cmp => {
      const parentEvent = this._findLastEvent(
        event =>
          event.eType !== 'dataRequest' &&
          (event.cmp === cmp || event.cmp === sourceCmp) &&
          event.tId === traceId
      );
      if (parentEvent) {
        eventId = parentEvent.eId;
        return false;
      }
      return true;
    });

    return eventId;
  }

  _getHierarchy(cmp) {
    let cmpType = this.getComponentType(cmp);
    let hierCmp = cmp;
    const hierarchy = [];

    while (cmpType) {
      hierarchy.push(hierCmp);
      hierCmp =
        hierCmp.clientMetricsParent ||
        hierCmp.ownerCt ||
        hierCmp.owner ||
        (hierCmp.initialConfig && hierCmp.initialConfig.owner);
      cmpType = hierCmp && this.getComponentType(hierCmp);
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
    for (let i = 0; i < this._pendingEvents.length; i += 1) {
      const ev = this._pendingEvents[i];
      if (ev.eId === eventId) {
        return ev;
      }
    }
    return null;
  }

  _findLastEvent(predicate) {
    for (let i = this._pendingEvents.length - 1; i >= 0; i -= 1) {
      const ev = this._pendingEvents[i];
      if (predicate(ev)) {
        return ev;
      }
    }
    return null;
  }

  _shouldRecordEvent(existingEvent, options) {
    if (options.whenLongerThan && options.stop - existingEvent.start <= options.whenLongerThan) {
      this._pendingEvents = this._pendingEvents.filter(ev => ev !== existingEvent);
      return false;
    }

    return true;
  }
}

export default Aggregator;
