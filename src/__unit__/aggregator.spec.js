import Aggregator, { getRallyRequestId } from '../aggregator';
import CorsBatchSender from '../corsBatchSender';
import { assign } from '../util';
import { stub, useFakeTimers, useFakeXMLHttpRequest } from '../../test-utils/specHelper';

const uuidFormat = /[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89aAbB][a-f0-9]{3}-[a-f0-9]{12}/;
let aggregator, sentEvents;

class Panel {
  constructor(config) {
    this.name = 'Panel';
    assign(this, config);
  }

  add(config) {
    return new Panel({ ownerCt: this });
  }
}

const recordAction = (aggregator, cmp, description) => {
  if (description == null) {
    description = 'an action';
  }
  if (cmp == null) {
    cmp = new Panel();
  }
  aggregator.recordAction({
    component: cmp,
    description: description,
  });
  return cmp;
};
const beginLoad = (aggregator, cmp, description, miscData) => {
  if (description == null) {
    description = 'an action';
  }
  if (miscData == null) {
    miscData = {};
  }
  if (cmp == null) {
    cmp = new Panel();
  }
  aggregator.beginLoad({
    component: cmp,
    description: description,
    miscData: miscData,
  });
  return cmp;
};
const endLoad = (aggregator, cmp) => {
  if (cmp == null) {
    cmp = new Panel();
  }
  aggregator.endLoad({
    component: cmp,
  });
  return cmp;
};
const recordError = (aggregator, error, miscData) => {
  let err = error;
  if (error == null) {
    try {
      throw new Error('an error');
    } catch (e) {
      err = e;
    }
  }
  aggregator.recordError(err, miscData);
  return err;
};
const startSession = (aggregator, status, defaultParams) => {
  if (status == null) {
    status = 'Navigation';
  }
  if (defaultParams == null) {
    defaultParams = {};
  }
  aggregator.startSession(status, defaultParams);

  return { status, defaultParams };
};
const createAggregator = config => {
  if (config == null) {
    config = {};
  }
  const handler = {
    getAppName: stub().returns('testAppName'),
    getComponentType(cmp) {
      return cmp.name || false;
    },
  };
  const aggregatorConfig = assign(
    {},
    {
      sender: createSender(),
      handlers: [handler],
    },
    config
  );
  return new Aggregator(aggregatorConfig);
};
const createSender = () => {
  sentEvents = [];
  return {
    send(events) {
      sentEvents.push(events);
    },
    getMaxLength() {
      return 2000;
    },
    flush: stub(),
  };
};
const createAggregatorAndRecordAction = (config = {}) => {
  aggregator = createAggregator(config);
  recordAction(aggregator);
  return aggregator;
};
const findActionEvent = () => sentEvents.find(ev => ev.eType === 'action');
const findLoadEvent = () => sentEvents.find(ev => ev.eType === 'load');
const findDataEvent = () => sentEvents.find(ev => ev.eType === 'dataRequest');
const findErrorEvent = () => sentEvents.find(ev => ev.eType === 'error');
const findComponentReadyEvent = () =>
  sentEvents.find(ev => ev.eType === 'load' && ev.componentReady);

describe('Aggregator', () => {
  const rallyRequestId = 123456;

  afterEach(() => {
    if (aggregator) {
      aggregator.destroy();
    }
  });

  describe('batch sender', () => {
    it('should create a batch sender if one is not provided', () => {
      aggregator = new Aggregator({});
      expect(aggregator.sender).toBeInstanceOf(CorsBatchSender);
    });

    it('should be disabled if configured', () => {
      aggregator = new Aggregator({
        disableSending: true,
      });
      expect(aggregator.sender.isDisabled()).toBeTruthy();
    });
  });

  describe('flushInterval', () => {
    it('should flush on the specified interval', function() {
      const clock = useFakeTimers();
      aggregator = createAggregator({
        flushInterval: 10,
      });
      const start = Date.now();
      clock.tick(10);
      clock.tick(10);
      expect(aggregator.sender.flush.callCount).toEqual(2);
    });
  });

  describe('#addHandler', () => {
    it('should add handler to the end', () => {
      aggregator = createAggregator();
      const newHandler = {
        foo: 'bar',
      };
      aggregator.addHandler(newHandler);
      expect(aggregator.handlers.length).toEqual(2);
      expect(aggregator.handlers[1]).toEqual(newHandler);
    });
  });

  describe('#startSession', () => {
    it('should flush the sender', () => {
      aggregator = createAggregator();
      startSession(aggregator);
      expect(aggregator.sender.flush).toHaveBeenCalledOnce();
    });
    it('should append defaultParams to events', () => {
      aggregator = createAggregator();
      const hash = '/some/hash';
      const defaultParams = {
        hash: hash,
      };
      aggregator.startSession('Session 1', defaultParams);
      recordAction(aggregator);

      const actionEvent = findActionEvent();
      expect(actionEvent.hash).toEqual(hash);
    });
    it('does not add sessionStart value to default params', () => {
      aggregator = createAggregator();
      const hash = '/some/hash';
      const startingTime = Date.now() - 5000;
      const defaultParams = {
        hash: hash,
        sessionStart: startingTime,
      };
      aggregator.startSession('Session 1', defaultParams);
      expect(aggregator.getDefaultParams().sessionStart).toBeUndefined();
    });
  });

  describe('#sendAllRemainingEvents', () => {
    it('should flush the sender', () => {
      aggregator = createAggregator();
      aggregator.sendAllRemainingEvents();
      expect(aggregator.sender.flush).toHaveBeenCalledOnce();
    });
  });

  describe('data requests', () => {
    let xhrFake;

    beforeEach(() => {
      xhrFake = useFakeXMLHttpRequest();
    });
    afterEach(() => {
      xhrFake.restore();
    });

    it('should accept miscData', () => {
      aggregator = createAggregatorAndRecordAction();
      const miscData = {
        such: 'wow',
      };
      const requester = {};

      const metricsData = aggregator.beginDataRequest(requester, '/foo', miscData);
      aggregator.endDataRequest(requester, xhrFake, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.such).toEqual('wow');
    });
    it('should trim the request url correctly', () => {
      aggregator = createAggregatorAndRecordAction();
      const expectedUrl = '3.14/Foo.js';
      const entireUrl = 'http://localhost/testing/webservice/' + expectedUrl + '?bar=baz&boo=buzz';
      const requester = {};
      const metricsData = aggregator.beginDataRequest(requester, entireUrl);

      aggregator.endDataRequest(requester, xhrFake, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.url).toEqual(expectedUrl);
    });
    it('should have the component hierarchy for Ext4 nesting', () => {
      aggregator = createAggregatorAndRecordAction();
      const parentPanel = new Panel();
      const childPanel = parentPanel.add({
        xtype: 'panel',
      });

      const metricsData = aggregator.beginDataRequest(childPanel, 'someUrl');
      aggregator.endDataRequest(childPanel, xhrFake, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.cmpH).toEqual('Panel:Panel');
    });
    it('should have the component hierarchy for Ext2 nesting', () => {
      aggregator = createAggregatorAndRecordAction();
      const parentObj = {
        name: 'Parent',
      };
      const childObj = {
        name: 'Child',
        owner: parentObj,
      };

      const metricsData = aggregator.beginDataRequest(childObj, 'someUrl');
      aggregator.endDataRequest(childObj, xhrFake, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.cmpH).toEqual('Child:Parent');
    });
    it('should have the component hierarchy for initialConfig nesting', () => {
      aggregator = createAggregatorAndRecordAction();
      const parentObj = {
        name: 'Parent',
      };
      const childObj = {
        name: 'Child',
        initialConfig: {
          owner: parentObj,
        },
      };

      const metricsData = aggregator.beginDataRequest(childObj, 'someUrl');
      aggregator.endDataRequest(childObj, xhrFake, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.cmpH).toEqual('Child:Parent');
    });
    it('should have the component hierarchy for clientMetricsParent property', () => {
      aggregator = createAggregatorAndRecordAction();
      const parentObj = {
        name: 'Parent',
      };
      const childObj = {
        name: 'Child',
        clientMetricsParent: parentObj,
      };

      const metricsData = aggregator.beginDataRequest(childObj, 'someUrl');
      aggregator.endDataRequest(childObj, xhrFake, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.cmpH).toEqual('Child:Parent');
    });
    it('returns ID properties for AJAX headers', () => {
      aggregator = createAggregatorAndRecordAction();
      const requester = {};

      const metricsData = aggregator.beginDataRequest(requester, 'someUrl');
      aggregator.endDataRequest(requester, xhrFake, metricsData.requestId);

      const actionEvent = findActionEvent();
      const dataEvent = findDataEvent();
      expect(metricsData.xhrHeaders).toEqual({
        'X-Parent-Id': dataEvent.eId,
        'X-Trace-Id': actionEvent.eId,
      });
    });
    it('does not return ID properties for AJAX headers when request is not instrumented', () => {
      aggregator = createAggregatorAndRecordAction();

      const metricsData = aggregator.beginDataRequest(null, 'someUrl');

      expect(metricsData).toBeUndefined();
    });
    it('appends the rallyRequestId onto dataRequest events', () => {
      aggregator = createAggregatorAndRecordAction();
      const requester = {};
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'someUrl', true);
      xhr.send('data');
      xhr.setResponseHeaders({
        RallyRequestID: rallyRequestId,
      });
      xhr.setResponseBody('textual healing');

      const metricsData = aggregator.beginDataRequest(requester, 'someUrl');
      aggregator.endDataRequest(requester, xhr, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.rallyRequestId).toEqual(rallyRequestId);
    });

    describe('passing in traceId', () => {
      it('should allow options parameter for begin/endDataRequest', () => {
        aggregator = createAggregatorAndRecordAction();
        const requester = {};

        const metricsData = aggregator.beginDataRequest({
          requester: requester,
          url: 'someUrl',
          miscData: {
            doge: 'wow',
          },
        });
        aggregator.endDataRequest({
          requester: requester,
          xhr: xhrFake,
          requestId: metricsData.requestId,
        });

        const dataEvent = findDataEvent();
        expect(dataEvent.url).toEqual('someUrl');
        expect(dataEvent.tId).toMatch(uuidFormat);
        expect(dataEvent.eId).toMatch(uuidFormat);
        expect(dataEvent.pId).toMatch(uuidFormat);
        expect(dataEvent.doge).toEqual('wow');
      });
    });
  });
  describe('client metric event properties', () => {
    let actionEvent, aggregator, appName, browserTabId, loadEvent;

    beforeEach(() => {
      appName = 'testAppName';
      const parentPanel = new Panel();
      const childPanel = parentPanel.add({
        xtype: 'panel',
      });
      aggregator = createAggregator();
      recordAction(aggregator, parentPanel);
      beginLoad(aggregator, childPanel);
      endLoad(aggregator, childPanel);
      actionEvent = sentEvents[0];
      loadEvent = sentEvents[1];
      browserTabId = aggregator._browserTabId;
    });
    it('should generate uuids for the event id and trace id', () => {
      expect(loadEvent.tId).toMatch(uuidFormat);
      expect(loadEvent.eId).toMatch(uuidFormat);
      expect(loadEvent.pId).toMatch(uuidFormat);
      expect(loadEvent.tabId).toMatch(uuidFormat);
    });
    it('should have trace id and event id for the action event', () => {
      expect(typeof actionEvent.tId).toBe('string');
      expect(actionEvent.eId).toEqual(actionEvent.tId);
    });
    it('should not set the parent id for the action event', () => {
      expect(actionEvent.pId).toBeUndefined();
    });
    it('should put the browser tab id on the events', () => {
      expect(actionEvent.tabId).toEqual(browserTabId);
      expect(loadEvent.tabId).toEqual(browserTabId);
    });
    it('should put the browser timestamp on the events', () => {
      expect(typeof loadEvent.bts).toBe('number');
      expect(typeof actionEvent.bts).toBe('number');
    });
    it('should put the app name on the events', () => {
      expect(loadEvent.appName).toEqual(appName);
      expect(actionEvent.appName).toEqual(appName);
    });
    it('should parent the load event to the action event', () => {
      expect(typeof loadEvent.pId).toBe('string');
      expect(loadEvent.pId).toEqual(actionEvent.eId);
    });
    it('should have a common trace id for all the events', () => {
      expect(typeof loadEvent.tId).toBe('string');
      expect(typeof actionEvent.tId).toBe('string');
      expect(actionEvent.tId).toEqual(loadEvent.tId);
    });
    it('should have a component type for the load event', () => {
      expect(typeof loadEvent.cmpType).toBe('string');
    });
    it('should put the component hierarchy on the events', () => {
      expect(actionEvent.cmpH).toEqual('Panel');
      expect(loadEvent.cmpH).toEqual('Panel:Panel');
    });
    it('puts start time on all events', () => {
      expect(typeof actionEvent.start).toBe('number');
      expect(typeof loadEvent.start).toBe('number');
    });
    it('puts stop time on the load event', () => {
      expect(typeof loadEvent.stop).toBe('number');
    });
  });
  describe('finding traceIDs', () => {
    it('should find the correct traceId', () => {
      aggregator = createAggregator();
      const parentPanel = new Panel();
      const childPanel = parentPanel.add({
        xtype: 'panel',
      });
      recordAction(aggregator, parentPanel);
      recordAction(aggregator, parentPanel);
      beginLoad(aggregator, childPanel);
      endLoad(aggregator, childPanel);
      const secondActionEvent = sentEvents[1];
      const loadEvent = sentEvents[2];
      expect(loadEvent.pId).toEqual(secondActionEvent.eId);
    });
    it('should not parent to an event that has completed', () => {
      aggregator = createAggregator();
      const parentPanel = new Panel();
      const childPanel1 = parentPanel.add({
        xtype: 'panel',
      });
      const childPanel2 = parentPanel.add({
        xtype: 'panel',
      });
      recordAction(aggregator, parentPanel);
      beginLoad(aggregator, parentPanel);
      beginLoad(aggregator, childPanel1);
      endLoad(aggregator, childPanel1);
      endLoad(aggregator, parentPanel);
      beginLoad(aggregator, childPanel2);
      endLoad(aggregator, childPanel2);
      const actionEvent = sentEvents[0];
      const parentLoadEvent = sentEvents[2];
      const childPanel1LoadEvent = sentEvents[1];
      const childPanel2LoadEvent = sentEvents[3];
      expect(parentLoadEvent.tId).toEqual(actionEvent.eId);
      expect(childPanel1LoadEvent.tId).toEqual(actionEvent.eId);
      expect(childPanel2LoadEvent.tId).toEqual(actionEvent.eId);
      expect(childPanel1LoadEvent.pId).toEqual(parentLoadEvent.eId);
      expect(childPanel2LoadEvent.pId).toEqual(actionEvent.eId);
    });
  });
  describe('miscData', () => {
    it('should append miscData to an event and not overwrite known properties', () => {
      aggregator = createAggregatorAndRecordAction();
      const miscData = {
        eId: 'this shouldnt clobeber the real eId',
        foo: 'this should get through',
      };
      const cmp = beginLoad(aggregator, null, 'a load', miscData);
      endLoad(aggregator, cmp);
      const loadEvent = findLoadEvent();
      expect(typeof loadEvent.eId).toBe('string');
      expect(loadEvent.eId).not.toEqual(miscData.eId);
      expect(loadEvent.foo).toEqual(miscData.foo);
    });
  });
  describe('#recordAction', () => {
    it('should return the traceId', () => {
      aggregator = createAggregator();
      const traceId = aggregator.recordAction({
        component: {},
        description: 'an action',
      });
      expect(traceId).toMatch(uuidFormat);
    });
    it('should use the passed-in startTime', () => {
      aggregator = createAggregator();
      aggregator.recordAction({
        component: {},
        description: 'an action',
        startTime: 100,
      });
      const span = findActionEvent();
      expect(span.start).toEqual(aggregator.getRelativeTime(100));
      expect(span.bts).toEqual(100);
    });
  });

  describe('#startSpan', () => {
    let panel, actionTraceId;

    beforeEach(() => {
      panel = new Panel();
      aggregator = createAggregator();
      aggregator.startSession({});
      actionTraceId = aggregator.recordAction({
        component: panel,
        description: 'initial action',
      });
    });
    it('sends the span when it is ended', () => {
      sentEvents = [];
      const span = aggregator.startSpan({
        component: panel,
        description: 'panel loading',
      });
      span.end();
      expect(sentEvents.length).toEqual(1);
    });
    it('should allow a name to be passed in', () => {
      const span = aggregator.startSpan({
        component: panel,
        name: 'foo',
        description: 'panel loading',
      });
      span.end();

      const loadEvent = findLoadEvent();
      expect(loadEvent.cmpType).toEqual('foo');
    });
    it('should allow the hierarchy to be passed in', () => {
      const span = aggregator.startSpan({
        component: panel,
        hierarchy: 'foo:bar:baz',
        description: 'panel loading',
      });
      span.end();

      const loadEvent = findLoadEvent();
      expect(loadEvent.cmpH).toEqual('foo:bar:baz');
    });
    it('should allow the parent span id to be passed in', () => {
      const span = aggregator.startSpan({
        component: panel,
        pId: 'fee-fi-fo-fum',
        description: 'panel loading',
      });
      span.end();

      const loadEvent = findLoadEvent();
      expect(loadEvent.pId).toEqual('fee-fi-fo-fum');
    });
    it('should allow the parent span id to be passed in when ending span', () => {
      const span = aggregator.startSpan({
        component: panel,
        description: 'panel loading',
      });
      span.end({
        pId: 'fee-fi-fo-fum',
      });

      const loadEvent = findLoadEvent();
      expect(loadEvent.pId).toEqual('fee-fi-fo-fum');
    });
    it('should associate event started in previous action to the previous action', () => {
      const span = aggregator.startSpan({
        component: panel,
        description: 'panel loading',
      });
      aggregator.recordAction({
        component: panel,
        description: 'another action',
      });
      sentEvents = [];
      span.end();
      expect(sentEvents.length).toEqual(1);
      expect(sentEvents[0].tId).toEqual(actionTraceId);
    });
  });

  describe('#recordError', () => {
    const limitStack = (stack, stackLimit) => {
      return stack.split('\n').slice(0, stackLimit).join('\n');
    };

    it('sends an error event', () => {
      aggregator = createAggregatorAndRecordAction();
      const errorMessage = recordError(aggregator);

      expect(sentEvents.length).toEqual(2);
      const errorEvent = findErrorEvent();
      expect(errorEvent.eType).toEqual('error');
      expect(errorEvent.error).toEqual(errorMessage.message);
    });

    it('limits the stack to 20 lines by default', () => {
      aggregator = createAggregatorAndRecordAction();
      const errorMessage = recordError(aggregator);
      const errorEvent = findErrorEvent();

      expect(errorEvent.stack).toEqual(limitStack(errorMessage.stack, 20));
    });

    it('limits the stack to 2 lines when configured', () => {
      aggregator = createAggregatorAndRecordAction({ stackLimit: 2 });
      const errorMessage = recordError(aggregator);
      const errorEvent = findErrorEvent();

      expect(errorEvent.stack).toEqual(limitStack(errorMessage.stack, 2));
    });

    it('filters stacks that match ignoreStackMatcher', () => {
      const ignoreStackMatcher = /recordError/;
      aggregator = createAggregatorAndRecordAction({ ignoreStackMatcher });

      recordError(aggregator);
      const errorEvent = findErrorEvent();

      expect(ignoreStackMatcher.test(errorEvent.stack)).toEqual(false);
    });

    it('does not create an error event if the error limit has been reached', () => {
      aggregator = createAggregatorAndRecordAction({
        errorLimit: 3,
      });
      expect(sentEvents.length).toEqual(1);
      const errorMessages = [];
      for (let i = 0; i < 5; i++) {
        errorMessages.push(recordError(aggregator));
      }
      expect(sentEvents.length).toEqual(4);
      sentEvents.slice(1).forEach((errorEvent, i) => {
        expect(errorEvent.error).toEqual('an error');
        expect(errorEvent.stack).toEqual(limitStack(errorMessages[i].stack, 20));
      });
    });

    it('resets the error count whenever a new session starts', () => {
      aggregator = createAggregator();
      aggregator._errorCount = 2;
      aggregator.startSession('newsession');
      expect(aggregator._errorCount).toEqual(0);
    });

    it('truncates long error info', () => {
      let errorMessage = '';
      for (let i = 1; i <= 1000; i++) {
        errorMessage += 'uh oh';
      }
      expect(errorMessage.length).toBeGreaterThan(2000);
      aggregator = createAggregatorAndRecordAction();
      try {
        throw new Error(errorMessage);
      } catch (e) {
        recordError(aggregator, errorMessage);

        expect(sentEvents.length).toEqual(2);
        const errorEvent = findErrorEvent();
        expect(errorEvent.error.length).toBeLessThan(2000);
      }
    });

    it('should send miscData keys and values if provided', () => {
      aggregator = createAggregatorAndRecordAction();
      const miscData = {
        key1: 'value1',
        key2: 2,
      };
      try {
        throw new Error('error');
      } catch (e) {
        recordError(aggregator, e, miscData);

        const errorEvent = findErrorEvent();
        expect(errorEvent.error).toEqual(e.message);
        expect(errorEvent.stack).toEqual(limitStack(e.stack, 20));
        expect(errorEvent.key1).toEqual('value1');
        expect(errorEvent.key2).toEqual(2);
      }
    });

    it('should allow an options object parameter', () => {
      aggregator = createAggregatorAndRecordAction();
      aggregator.recordError('an error occured', {
        stack: 'wow',
      });

      const errorEvent = findErrorEvent();
      expect(errorEvent.error).toEqual('an error occured');
      expect(errorEvent.stack).toEqual('wow');
    });
  });

  describe('#recordComponentReady', () => {
    let panel;

    beforeEach(() => {
      aggregator = createAggregator();
      panel = new Panel();
    });
    it('should not record a component ready if there is no session', () => {
      aggregator.recordComponentReady({
        component: panel,
      });
      expect(sentEvents.length).toEqual(0);
      expect(findComponentReadyEvent()).toBeUndefined();
    });
    it('should not record a component ready if there is a session but no action', () => {
      startSession(aggregator);
      aggregator.recordComponentReady({
        component: panel,
      });
      expect(sentEvents.length).toEqual(0);
      expect(findComponentReadyEvent()).toBeUndefined();
    });
    it('should not record a component ready if a session is started, an action is recorded, a new sesson is started, but an action does not follow the new session', () => {
      startSession(aggregator);
      recordAction(aggregator, panel);
      startSession(aggregator);
      aggregator.recordComponentReady({
        component: panel,
      });
      expect(sentEvents.length).toEqual(1);
      expect(findComponentReadyEvent()).toBeUndefined();
    });
    it('should record a component ready if there is a session followed by an action', () => {
      startSession(aggregator);
      recordAction(aggregator, panel);
      aggregator.recordComponentReady({
        component: panel,
      });
      const componentReadyEvent = findComponentReadyEvent();
      expect(sentEvents.length).toEqual(2);
      expect(componentReadyEvent.eType).toEqual('load');
      expect(componentReadyEvent.componentReady).toEqual(true);
    });
    it('should record the traceId if one is present', () => {
      startSession(aggregator);
      recordAction(aggregator, panel);
      aggregator.recordComponentReady({
        component: panel,
      });

      const actionEvent = findActionEvent();
      const componentReadyEvent = findComponentReadyEvent();
      expect(sentEvents.length).toEqual(2);
      expect(actionEvent.tId).toEqual(actionEvent.eId);
      expect(componentReadyEvent.tId).toEqual(actionEvent.eId);
      expect(componentReadyEvent.pId).toEqual(actionEvent.eId);
      expect(componentReadyEvent.componentReady).toEqual(true);
    });
    it('should record a start time equal to the action start time', () => {
      startSession(aggregator);
      recordAction(aggregator, panel);
      aggregator.recordComponentReady({
        component: panel,
      });

      const componentReadyEvent = findComponentReadyEvent();
      expect(sentEvents.length).toEqual(2);
      expect(typeof componentReadyEvent.start).toBe('number');
      expect(componentReadyEvent.start).toEqual(aggregator._actionStartTime);
      expect(typeof componentReadyEvent.stop).toBe('number');
      expect(componentReadyEvent.componentReady).toEqual(true);
    });
    it('should record component as ready multiple times per session', () => {
      startSession(aggregator);
      recordAction(aggregator, panel);
      aggregator.recordComponentReady({
        component: panel,
      });
      aggregator.recordComponentReady({
        component: panel,
      });
      expect(sentEvents.length).toEqual(3);
    });
  });

  describe('#getCurrentTraceId', () => {
    it('should return null if no actions have been recorded', () => {
      aggregator = createAggregator();
      expect(aggregator.getCurrentTraceId()).toBeNull();
    });

    it('should return the traceId of the most recently recorded action', () => {
      aggregator = createAggregator();
      const firstTraceId = aggregator.recordAction({
        component: {},
        description: 'an action',
      });
      expect(aggregator.getCurrentTraceId()).toEqual(firstTraceId);

      const secondTraceId = aggregator.recordAction({
        component: {},
        description: 'an action',
      });
      expect(aggregator.getCurrentTraceId()).toEqual(secondTraceId);
    });
  });

  describe('#getRallyRequestId', () => {
    it('should find the RallyRequestId on an object', () => {
      const response = {
        getResponseHeader: {
          RallyRequestID: 'myrequestid',
        },
      };
      expect(getRallyRequestId(response)).toEqual('myrequestid');
    });
    it('should find the RallyRequestId from a function', () => {
      const response = {
        getResponseHeader: stub().returns('myrequestid'),
      };
      expect(getRallyRequestId(response)).toEqual('myrequestid');
      expect(response.getResponseHeader).toHaveBeenCalledWith('RallyRequestID');
    });
    it('should not find a RallyRequestId if there is no getResponseHeader', () => {
      const response = {};
      expect(getRallyRequestId(response)).toBeNull();
    });
    it('should not find a RallyRequestId if there getResponseHeader is something else', () => {
      const response = {
        getResponseHeader: 123,
      };
      expect(getRallyRequestId(response)).toBeNull();
    });
    it('should find a RallyRequestID if there is a headers method', () => {
      const response = {
        headers: stub().returns('myrequestid'),
      };
      expect(getRallyRequestId(response)).toEqual('myrequestid');
      expect(response.headers).toHaveBeenCalledWith('RallyRequestID');
    });
    it('should find a RallyRequestId if the response is a string', () => {
      expect(getRallyRequestId('ImARequestId')).toEqual('ImARequestId');
    });
    it('should not find a RallyRequestId if the response is a number', () => {
      expect(getRallyRequestId(123)).toBeNull();
    });
  });

  describe('whenLongerThan parameter', () => {
    it("should not send the event if the duration is not longer than the 'whenLongerThan' parameter value", () => {
      aggregator = createAggregatorAndRecordAction();
      sentEvents = [];
      const startTime = 50;
      const cmp = new Panel();
      aggregator.beginLoad({
        component: cmp,
        description: 'a load',
        startTime: startTime,
      });
      aggregator.endLoad({
        component: cmp,
        stopTime: startTime + 1000,
        whenLongerThan: 1000,
      });
      expect(sentEvents.length).toEqual(0);
    });

    it("should send the event if the duration is longer than the 'whenLongerThan' parameter value", () => {
      aggregator = createAggregatorAndRecordAction();
      sentEvents = [];
      const startTime = 50;
      const cmp = new Panel();
      aggregator.beginLoad({
        component: cmp,
        description: 'a load',
        startTime: startTime,
      });
      aggregator.endLoad({
        component: cmp,
        stopTime: startTime + 1001,
        whenLongerThan: 1000,
      });
      expect(sentEvents.length).toEqual(1);
    });
  });
});
