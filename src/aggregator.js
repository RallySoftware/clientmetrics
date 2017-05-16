// @ts-check
/**
 * @module
 */
import uuidV4 from 'uuid/v4';
import BatchSender from './corsBatchSender';
import { assign, omit } from './util';

// The default for max number of errors we will send per session.
const DEFAULT_ERROR_LIMIT = 25;

// The default number of lines to keep in error stack traces
const DEFAULT_STACK_LIMIT = 20;

/**
 * Creates a version 4 UUID
 * @private
 */
const getUniqueId = () => uuidV4();

const shouldRecordEvent = event =>
  !event.whenLongerThan || event.stop - event.start > event.whenLongerThan;

/**
 * An aggregator that exposes methods to record client metrics and send the data
 * to an endpoint which collects the data for analysis
 *
 * ## Aggregator specific terminology
 *
 * * **event:** A distinct, measurable thing that the page did or the user invoked.
 *     For example, clicking on a button, a panel loading, or a grid resorting are all events
 * * **handler:** A helper object that helps the aggregator identify where events came from.
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
    this._browserTabId = getUniqueId();
    this._startingTime = Date.now();
    this._currentTraceId = null;

    // keep track of how many errors we have reported on, so we
    // can stop after a while and not flood the beacon
    this._errorCount = 0;
    this._errorLimit = config.errorLimit || DEFAULT_ERROR_LIMIT;
    this._stackLimit = config.stackLimit || DEFAULT_STACK_LIMIT;

    this.sender =
      config.sender ||
      new BatchSender({
        keysToIgnore: ['cmp', 'component', 'whenLongerThan'],
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
          cmpH: options.hierarchy,
          eDesc: options.description,
          eId: traceId,
          tId: traceId,
          cmpType: options.name,
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
    const cmpHierarchy = options.hierarchy;

    const cmpReadyEvent = this._startEvent(
      assign({}, options.miscData, {
        eType: 'load',
        start: this._actionStartTime,
        stop: this.getRelativeTime(options.stopTime),
        eId: getUniqueId(),
        tId: traceId,
        pId: traceId,
        cmpType: options.name,
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
      cmpH: options.hierarchy,
      eId: eventId,
      cmpType: options.name,
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
            stop: this.getRelativeTime(endOptions.stopTime),
          },
          omit(endOptions, ['stopTime'])
        );
        this._finishEvent(data, newEventData);
      },
    };
  }

  /**
   * Causes the batch sender to send all events it still has in its queue.
   * Typically done when the user navigates somewhere
   */
  sendAllRemainingEvents() {
    this.sender.flush();
  }

  getDefaultParams() {
    return this._defaultParams;
  }

  getCurrentTraceId() {
    return this._currentTraceId;
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
  _finishEvent(existingEvent, newEventData = {}) {
    const event = assign({}, existingEvent, newEventData);
    if (shouldRecordEvent(event)) {
      this.sender.send(event);
    }
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

    return assign(addlFields, event, this._defaultParams);
  }
}

export default Aggregator;
