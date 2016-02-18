import Aggregator, { getRallyRequestId } from '../aggregator';
import CorsBatchSender from '../corsBatchSender';
import { assign } from '../util';
import { once } from '../../test-utils/specHelper';

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
    description = "an action";
  }
  if (cmp == null) {
    cmp = new Panel();
  }
  aggregator.recordAction({
    component: cmp,
    description: description
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
    miscData: miscData
  });
  return cmp;
};
const endLoad = (aggregator, cmp) => {
  if (cmp == null) {
    cmp = new Panel();
  }
  aggregator.endLoad({
    component: cmp
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
    status = "Navigation";
  }
  if (defaultParams == null) {
    defaultParams = {};
  }
  aggregator.startSession(status, defaultParams);
  return {
    status: status,
    defaultParams: defaultParams
  };
};
const createAggregator = (config) => {
  if (config == null) {
    config = {};
  }
  const handler = {
    getAppName: sinon.stub().returns('testAppName'),
    getComponentType(cmp) {
      return cmp.name || false;
    }
  };
  const aggregatorConfig = assign({}, {
    sender: createSender(),
    handlers: [handler]
  }, config);
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
    flush: sinon.stub()
  };
};
const createAggregatorAndRecordAction = (config = {}) => {
  const aggregator = createAggregator(config);
  recordAction(aggregator);
  return aggregator;
};
const findActionEvent = () => {
  return sentEvents.filter(ev => ev.eType === 'action')[0];
};
const findLoadEvent = () => {
  return sentEvents.filter(ev => ev.eType === 'load')[0];
};
const findDataEvent = () => {
  return sentEvents.filter(ev => ev.eType === 'dataRequest')[0];
};
const findErrorEvent = () => {
  return sentEvents.filter(ev => ev.eType === 'error')[0];
};
const findComponentReadyEvent = () => {
  return sentEvents.filter(ev => ev.eType === 'load' && ev.componentReady)[0];
};
const findComponentReadyEvents = () => {
  return sentEvents.filter(ev => ev.eType === 'load' && ev.componentReady);
};

describe("Aggregator", () => {
  const rallyRequestId = 123456;

  describe('batch sender', () => {
    it('should create a batch sender if one is not provided', () => {
      const aggregator = new Aggregator({});
      expect(aggregator.sender).to.be.an.instanceOf(CorsBatchSender);
    });
  });
  it('should disable the batch sender if configured', () => {
    const aggregator = new Aggregator({
      disableSending: true
    });
    expect(aggregator.sender.isDisabled()).to.be.true;
  });
  describe('flushInterval', () => {
    afterEach(() => {
      if (aggregator) {
        aggregator.destroy();
      }
    });
    it('should flush on the specified interval', function(done) {
      aggregator = createAggregator({
        flushInterval: 10
      });
      const start = Date.now();
      return once({
        condition: () => {
          return aggregator.sender.flush.callCount > 2;
        },
        description: 'waiting for flush to happen more than twice'
      }).done(() => {
        const stop = Date.now();
        expect(stop - start).to.be.greaterThan(20);
        return done();
      });
    });
  });
  describe('allowMultipleComponentReady', () => {
    function recordActionsAndComponentReady (options = {}, times = 2) {
      const panel = new Panel();
      aggregator = createAggregator();
      startSession(aggregator);
      const traceId = aggregator.recordAction(assign({
        component: {},
        description: "an action",
        startTime: 100
      }, options));
      while (times > 0) {
        aggregator.recordComponentReady({
          component: panel
        });
        times--;
      }
    }
    it('should only record one componentReady when recordAction is not called with option.allowMultipleComponentReady', () => {
      recordActionsAndComponentReady();
      const componentReadyEvents = findComponentReadyEvents();
      expect(componentReadyEvents.length).to.equal(1);
    });
    it('should only record one componentReady when recordAction is called with option.allowMultipleComponentReady == false', () => {
      recordActionsAndComponentReady({ allowMultipleComponentReady: false });
      const componentReadyEvents = findComponentReadyEvents();
      expect(componentReadyEvents.length).to.equal(1);
    });
    it('should record multiple componentReady when recordAction is called with option.allowMultipleComponentReady == true', () => {
      recordActionsAndComponentReady({ allowMultipleComponentReady: true });
      const componentReadyEvents = findComponentReadyEvents();
      expect(componentReadyEvents.length).to.equal(2);
    });
  });
  describe('#addHandler', () => {
    afterEach(() => {
      if (aggregator) {
        aggregator.destroy();
      }
    });
    it('should add handler with NO index specified', () => {
      aggregator = createAggregator();
      const newHandler = {
        foo: 'bar'
      };
      aggregator.addHandler(newHandler);
      expect(aggregator.handlers.length).to.equal(2);
      expect(aggregator.handlers[1]).to.equal(newHandler);
    });
    it('should add handler at specified index', () => {
      aggregator = createAggregator();
      const newHandler = {
        foo: 'bar'
      };
      aggregator.addHandler(newHandler, 0);
      expect(aggregator.handlers.length).to.equal(2);
      expect(aggregator.handlers[0]).to.equal(newHandler);
    });
  });
  describe('#startSession', () => {
    it("should start a new session", () => {
      const aggregator = createAggregator();
      const status = 'Navigation';
      const defaultParams = {
        foo: 'bar'
      };
      return startSession(aggregator, status, defaultParams);
    });
    it("should flush the sender", () => {
      const aggregator = createAggregator();
      startSession(aggregator);
      expect(aggregator.sender.flush).to.have.been.calledOnce;
    });
    it("should append defaultParams to events", () => {
      const aggregator = createAggregator();
      const hash = "/some/hash";
      const defaultParams = {
        hash: hash
      };
      aggregator.startSession("Session 1", defaultParams);
      recordAction(aggregator);

      const actionEvent = findActionEvent();
      expect(actionEvent.hash).to.equal(hash);
    });
    it("should allow a startTime in the past", () => {
      const aggregator = createAggregator();
      const hash = "/some/hash";
      const startingTime = Date.now() - 5000;
      const defaultParams = {
        hash: hash,
        sessionStart: startingTime
      };
      aggregator.startSession("Session 1", defaultParams);
      expect(aggregator.getSessionStartTime()).to.be.greaterThan(0);
      expect(aggregator.getDefaultParams().sessionStart).to.equal(void 0);
    });
  });
  describe('#sendAllRemainingEvents', () => {
    it('should flush the sender', () => {
      const aggregator = createAggregator();
      aggregator.sendAllRemainingEvents();
      expect(aggregator.sender.flush).to.have.been.calledOnce;
    });
  });

  describe('data requests', () => {
    let xhrFake;

    beforeEach(() => {
      xhrFake = sinon.useFakeXMLHttpRequest();
    });
    afterEach(() => {
      return xhrFake.restore();
    });

    it("should accept miscData", () => {
      const aggregator = createAggregatorAndRecordAction();
      const miscData = {
        such: "wow"
      };
      const requester = {};

      const metricsData = aggregator.beginDataRequest(requester, "/foo", miscData);
      aggregator.endDataRequest(requester, xhrFake, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.such).to.equal("wow");
    });
    it("should trim the request url correctly", () => {
      const aggregator = createAggregatorAndRecordAction();
      const expectedUrl = "3.14/Foo.js";
      const entireUrl = "http://localhost/testing/webservice/" + expectedUrl + "?bar=baz&boo=buzz";
      const requester = {};
      const metricsData = aggregator.beginDataRequest(requester, entireUrl);

      aggregator.endDataRequest(requester, xhrFake, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.url).to.equal(expectedUrl);
    });
    it("should have the component hierarchy for Ext4 nesting", () => {
      const aggregator = createAggregatorAndRecordAction();
      const parentPanel = new Panel();
      const childPanel = parentPanel.add({
        xtype: "panel"
      });

      const metricsData = aggregator.beginDataRequest(childPanel, "someUrl");
      aggregator.endDataRequest(childPanel, xhrFake, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.cmpH).to.equal("Panel:Panel");
    });
    it("should have the component hierarchy for Ext2 nesting", () => {
      const aggregator = createAggregatorAndRecordAction();
      const parentObj = {
        name: 'Parent'
      };
      const childObj = {
        name: 'Child',
        owner: parentObj
      };

      const metricsData = aggregator.beginDataRequest(childObj, "someUrl");
      aggregator.endDataRequest(childObj, xhrFake, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.cmpH).to.equal("Child:Parent");
    });
    it("should have the component hierarchy for initialConfig nesting", () => {
      const aggregator = createAggregatorAndRecordAction();
      const parentObj = {
        name: 'Parent'
      };
      const childObj = {
        name: 'Child',
        initialConfig: {
          owner: parentObj
        }
      };

      const metricsData = aggregator.beginDataRequest(childObj, "someUrl");
      aggregator.endDataRequest(childObj, xhrFake, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.cmpH).to.equal("Child:Parent");
    });
    it("should have the component hierarchy for clientMetricsParent property", () => {
      const aggregator = createAggregatorAndRecordAction();
      const parentObj = {
        name: 'Parent'
      };
      const childObj = {
        name: 'Child',
        clientMetricsParent: parentObj
      };

      const metricsData = aggregator.beginDataRequest(childObj, "someUrl");
      aggregator.endDataRequest(childObj, xhrFake, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.cmpH).to.equal("Child:Parent");
    });
    it("returns ID properties for AJAX headers", () => {
      const aggregator = createAggregatorAndRecordAction();
      const requester = {};

      const metricsData = aggregator.beginDataRequest(requester, "someUrl");
      aggregator.endDataRequest(requester, xhrFake, metricsData.requestId);

      const actionEvent = findActionEvent();
      const dataEvent = findDataEvent();
      expect(metricsData.xhrHeaders).to.eql({
        'X-Parent-Id': dataEvent.eId,
        'X-Trace-Id': actionEvent.eId
      });
    });
    it("does not return ID properties for AJAX headers when request is not instrumented", () => {
      const aggregator = createAggregatorAndRecordAction();

      const metricsData = aggregator.beginDataRequest(null, "someUrl");

      expect(metricsData).to.be.undefined;
    });
    it("appends the rallyRequestId onto dataRequest events", () => {
      const aggregator = createAggregatorAndRecordAction();
      const requester = {};
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'someUrl', true);
      xhr.send('data');
      xhr.setResponseHeaders({
        RallyRequestID: rallyRequestId
      });
      xhr.setResponseBody('textual healing');

      const metricsData = aggregator.beginDataRequest(requester, "someUrl");
      aggregator.endDataRequest(requester, xhr, metricsData.requestId);

      const dataEvent = findDataEvent();
      expect(dataEvent.rallyRequestId).to.equal(rallyRequestId);
    });
    return describe("passing in traceId", () => {
      it("should allow options parameter for begin/endDataRequest", () => {
        const aggregator = createAggregatorAndRecordAction();
        const requester = {};

        const metricsData = aggregator.beginDataRequest({
          requester: requester,
          url: "someUrl",
          miscData: {
            doge: 'wow'
          }
        });
        aggregator.endDataRequest({
          requester: requester,
          xhr: xhrFake,
          requestId: metricsData.requestId
        });

        const dataEvent = findDataEvent();
        expect(dataEvent.url).to.equal("someUrl");
        expect(dataEvent.tId).to.match(uuidFormat);
        expect(dataEvent.eId).to.match(uuidFormat);
        expect(dataEvent.pId).to.match(uuidFormat);
        expect(dataEvent.doge).to.equal("wow");
      });
    });
  });
  describe('client metric event properties', () => {
    let actionEvent, aggregator, appName, browserTabId, loadEvent;

    beforeEach(() => {
      appName = "testAppName";
      const parentPanel = new Panel();
      const childPanel = parentPanel.add({
        xtype: "panel"
      });
      aggregator = createAggregator();
      recordAction(aggregator, parentPanel);
      beginLoad(aggregator, childPanel);
      endLoad(aggregator, childPanel);
      actionEvent = sentEvents[0];
      loadEvent = sentEvents[1];
      browserTabId = aggregator._browserTabId;
    });
    it("should generate uuids for the event id and trace id", () => {
      expect(loadEvent.tId).to.match(uuidFormat);
      expect(loadEvent.eId).to.match(uuidFormat);
      expect(loadEvent.pId).to.match(uuidFormat);
      expect(loadEvent.tabId).to.match(uuidFormat);
    });
    it("should have trace id and event id for the action event", () => {
      expect(actionEvent.tId).to.be.a('string');
      expect(actionEvent.eId).to.equal(actionEvent.tId);
    });
    it("should not set the parent id for the action event", () => {
      expect(actionEvent.pId).to.be.undefined;
    });
    it("should put the browser tab id on the events", () => {
      expect(actionEvent.tabId).to.equal(browserTabId);
      expect(loadEvent.tabId).to.equal(browserTabId);
    });
    it("should put the browser timestamp on the events", () => {
      expect(loadEvent.bts).to.be.a('number');
      expect(actionEvent.bts).to.be.a('number');
    });
    it("should put the app name on the events", () => {
      expect(loadEvent.appName).to.equal(appName);
      expect(actionEvent.appName).to.equal(appName);
    });
    it("should parent the load event to the action event", () => {
      expect(loadEvent.pId).to.be.a('string');
      expect(loadEvent.pId).to.equal(actionEvent.eId);
    });
    it("should have a common trace id for all the events", () => {
      expect(loadEvent.tId).to.be.a('string');
      expect(actionEvent.tId).to.be.a('string');
      expect(actionEvent.tId).to.equal(loadEvent.tId);
    });
    it("should have a component type for the load event", () => {
      expect(loadEvent.cmpType).to.be.a('string');
    });
    it("should put the component hierarchy on the events", () => {
      expect(actionEvent.cmpH).to.equal("Panel");
      expect(loadEvent.cmpH).to.equal("Panel:Panel");
    });
    it("puts start time on all events", () => {
      expect(actionEvent.start).to.be.a('number');
      expect(loadEvent.start).to.be.a('number');
    });
    it("puts stop time on the load event", () => {
      expect(loadEvent.stop).to.be.a('number');
    });
  });
  describe('finding traceIDs', () => {
    it("should find the correct traceId", () => {
      const aggregator = createAggregator();
      const handler = aggregator.handlers[0];
      const parentPanel = new Panel();
      const childPanel = parentPanel.add({
        xtype: "panel"
      });
      recordAction(aggregator, parentPanel);
      recordAction(aggregator, parentPanel);
      beginLoad(aggregator, childPanel);
      endLoad(aggregator, childPanel);
      const secondActionEvent = sentEvents[1];
      const loadEvent = sentEvents[2];
      expect(loadEvent.pId).to.equal(secondActionEvent.eId);
    });
    it("should not parent to an event that has completed", () => {
      const aggregator = createAggregator();
      const handler = aggregator.handlers[0];
      const parentPanel = new Panel();
      const childPanel1 = parentPanel.add({
        xtype: "panel"
      });
      const childPanel2 = parentPanel.add({
        xtype: "panel"
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
      expect(parentLoadEvent.tId).to.equal(actionEvent.eId);
      expect(childPanel1LoadEvent.tId).to.equal(actionEvent.eId);
      expect(childPanel2LoadEvent.tId).to.equal(actionEvent.eId);
      expect(childPanel1LoadEvent.pId).to.equal(parentLoadEvent.eId);
      expect(childPanel2LoadEvent.pId).to.equal(actionEvent.eId);
    });
  });
  describe('miscData', () => {
    it("should append miscData to an event and not overwrite known properties", () => {
      const aggregator = createAggregatorAndRecordAction();
      const miscData = {
        eId: "this shouldnt clobeber the real eId",
        foo: "this should get through"
      };
      const cmp = beginLoad(aggregator, null, "a load", miscData);
      endLoad(aggregator, cmp);
      const loadEvent = findLoadEvent();
      expect(loadEvent.eId).to.be.a('string');
      expect(loadEvent.eId).not.to.equal(miscData.eId);
      expect(loadEvent.foo).to.equal(miscData.foo);
    });
  });
  describe("#recordAction", () => {
    it("should return the traceId", () => {
      const aggregator = createAggregator();
      const traceId = aggregator.recordAction({
        component: {},
        description: "an action"
      });
      expect(traceId).to.match(uuidFormat);
    });
    it("should use the passed-in startTime", () => {
      const aggregator = createAggregator();
      const traceId = aggregator.recordAction({
        component: {},
        description: "an action",
        startTime: 100
      });
      const span = findActionEvent();
      expect(span.start).to.equal(aggregator.getRelativeTime(100));
      expect(span.bts).to.equal(100);
    });
  });

  describe("#startSpan", () => {
    let panel, actionTraceId;

    beforeEach(() => {
      panel = new Panel();
      aggregator = createAggregator();
      aggregator.startSession({});
      actionTraceId = aggregator.recordAction({
        component: panel,
        description: 'initial action'
      });
    });
    it('sends the span when it is ended', () => {
      sentEvents = [];
      const span = aggregator.startSpan({
        component: panel,
        description: "panel loading"
      });
      span.end();
      expect(sentEvents.length).to.equal(1);
    });
    it("should allow a name to be passed in", () => {
      const span = aggregator.startSpan({
        component: panel,
        name: 'foo',
        description: "panel loading"
      });
      span.end();

      const loadEvent = findLoadEvent();
      expect(loadEvent.cmpType).to.equal('foo');
    });
    it("should allow the hierarchy to be passed in", () => {
      const span = aggregator.startSpan({
        component: panel,
        hierarchy: 'foo:bar:baz',
        description: "panel loading"
      });
      span.end();

      const loadEvent = findLoadEvent();
      expect(loadEvent.cmpH).to.equal('foo:bar:baz');
    });
    it("should allow the parent span id to be passed in", () => {
      const span = aggregator.startSpan({
        component: panel,
        pId: 'fee-fi-fo-fum',
        description: "panel loading"
      });
      span.end();

      const loadEvent = findLoadEvent();
      expect(loadEvent.pId).to.equal('fee-fi-fo-fum');
    });
    it("should allow the parent span id to be passed in when ending span", () => {
      const span = aggregator.startSpan({
        component: panel,
        description: "panel loading"
      });
      span.end({
        pId: 'fee-fi-fo-fum'
      });

      const loadEvent = findLoadEvent();
      expect(loadEvent.pId).to.equal('fee-fi-fo-fum');
    });
    it('should associate event started in previous action to the previous action', () => {
      const span = aggregator.startSpan({
        component: panel,
        description: "panel loading"
      });
      aggregator.recordAction({
        component: panel,
        description: 'another action'
      });
      sentEvents = [];
      span.end();
      expect(sentEvents.length).to.equal(1);
      expect(sentEvents[0].tId).to.equal(actionTraceId);
    });
  });

  describe('#recordError', () => {
    const limitStack = (stack, stackLimit) => {
      return stack.split('\n').slice(0, stackLimit).join('\n');
    };

    it("sends an error event", () => {
      const aggregator = createAggregatorAndRecordAction();
      const errorMessage = recordError(aggregator);

      expect(sentEvents.length).to.equal(2);
      const errorEvent = findErrorEvent();
      expect(errorEvent.eType).to.equal("error");
      expect(errorEvent.error).to.equal(errorMessage.message);
    });

    it("limits the stack to 10 lines by default", () => {
      const aggregator = createAggregatorAndRecordAction();
      const errorMessage = recordError(aggregator);
      const errorEvent = findErrorEvent();

      expect(errorEvent.stack).to.equal(limitStack(errorMessage.stack, 10));
    });

    it("limits the stack to 2 lines when configured", () => {
      const aggregator = createAggregatorAndRecordAction({ stackLimit: 2 });
      const errorMessage = recordError(aggregator);
      const errorEvent = findErrorEvent();

      expect(errorEvent.stack).to.equal(limitStack(errorMessage.stack, 2));
    });

    it("does not create an error event if the error limit has been reached", () => {
      const aggregator = createAggregatorAndRecordAction({
        errorLimit: 3
      });
      expect(sentEvents.length).to.equal(1);
      const errorMessages = [];
      for (let i = 0; i < 5; i++) {
        errorMessages.push(recordError(aggregator));
      }
      expect(sentEvents.length).to.equal(4);
      const ref = sentEvents.slice(1).forEach((errorEvent, i) => {
        expect(errorEvent.error).to.equal("an error");
        expect(errorEvent.stack).to.equal(limitStack(errorMessages[i].stack, 10));
      });
    });

    it("resets the error count whenever a new session starts", () => {
      const aggregator = createAggregator();
      aggregator._errorCount = 2;
      aggregator.startSession("newsession");
      expect(aggregator._errorCount).to.equal(0);
    });

    it("truncates long error info", () => {
      let errorMessage = "";
      for (let i = 1; i <= 1000; i++) {
        errorMessage += "uh oh";
      }
      expect(errorMessage.length).to.be.greaterThan(2000);
      const aggregator = createAggregatorAndRecordAction();
      try {
        throw new Error(errorMessage);
      } catch (e) {
        recordError(aggregator, errorMessage);

        expect(sentEvents.length).to.equal(2);
        const errorEvent = findErrorEvent();
        expect(errorEvent.error.length).to.be.lessThan(2000);
      }
    });

    it("should send miscData keys and values if provided", () => {
      const aggregator = createAggregatorAndRecordAction();
      const miscData = {
        key1: 'value1',
        key2: 2
      };
      try {
        throw new Error("error");
      } catch (e) {
        recordError(aggregator, e, miscData);

        const errorEvent = findErrorEvent();
        expect(errorEvent.error).to.equal(e.message);
        expect(errorEvent.stack).to.equal(limitStack(e.stack, 10));
        expect(errorEvent.key1).to.equal('value1');
        expect(errorEvent.key2).to.equal(2);
      }
    });

    it("should allow an options object parameter", () => {
      const aggregator = createAggregatorAndRecordAction();
      aggregator.recordError("an error occured", {
        stack: 'wow'
      });

      const errorEvent = findErrorEvent();
      expect(errorEvent.error).to.equal("an error occured");
      expect(errorEvent.stack).to.equal("wow");
    });
  });

  describe("#recordComponentReady", () => {
    let panel;

    beforeEach(() => {
      aggregator = createAggregator();
      panel = new Panel();
    });
    it("should not record a component ready if there is no session", () => {
      aggregator.recordComponentReady({
        component: panel
      });
      expect(sentEvents.length).to.equal(0);
    });
    it("should record component ready even if there is not a current trace", () => {
      startSession(aggregator);
      aggregator.recordComponentReady({
        component: panel
      });
      const componentReadyEvent = findComponentReadyEvent();
      expect(sentEvents.length).to.equal(1);
      expect(componentReadyEvent.tId).to.be.undefined;
      expect(componentReadyEvent.componentReady).to.equal(true);
    });
    it("should record the traceId if one is present", () => {
      startSession(aggregator);
      recordAction(aggregator, panel);
      aggregator.recordComponentReady({
        component: panel
      });

      const actionEvent = findActionEvent();
      const componentReadyEvent = findComponentReadyEvent();
      expect(sentEvents.length).to.equal(2);
      expect(actionEvent.tId).to.equal(actionEvent.eId);
      expect(componentReadyEvent.tId).to.equal(actionEvent.eId);
      expect(componentReadyEvent.pId).to.equal(actionEvent.eId);
      expect(componentReadyEvent.componentReady).to.equal(true);
    });
    it("should record a start time equal to the session start time", () => {
      startSession(aggregator);
      aggregator.recordComponentReady({
        component: panel
      });

      const componentReadyEvent = findComponentReadyEvent();
      expect(sentEvents.length).to.equal(1);
      expect(componentReadyEvent.start).to.be.a('number');
      expect(componentReadyEvent.start).to.equal(aggregator._sessionStartTime);
      expect(componentReadyEvent.stop).to.be.a('number');
      expect(componentReadyEvent.componentReady).to.equal(true);
    });
    it("should record a component as ready only once per session", () => {
      startSession(aggregator);
      aggregator.recordComponentReady({
        component: panel
      });
      aggregator.recordComponentReady({
        component: panel
      });
      const componentReadyEvent = findComponentReadyEvent();
      expect(sentEvents.length).to.equal(1);
      expect(componentReadyEvent.eType).to.equal("load");
      expect(componentReadyEvent.componentReady).to.equal(true);
    });
    it("should ignore a second component's ready if it has the same hierarchy as the previous component", () => {
      startSession(aggregator);
      aggregator.recordComponentReady({
        component: panel
      });
      aggregator.recordComponentReady({
        component: new Panel()
      });
      expect(sentEvents.length).to.equal(1);
      const componentReadyEvent = findComponentReadyEvent();
      expect(componentReadyEvent.eType).to.equal("load");
      expect(componentReadyEvent.componentReady).to.equal(true);
    });
    it("should record a component as ready a second time if a new session started", () => {
      startSession(aggregator);
      aggregator.recordComponentReady({
        component: panel
      });
      aggregator.recordComponentReady({
        component: panel
      });
      startSession(aggregator);
      aggregator.recordComponentReady({
        component: panel
      });
      expect(sentEvents.length).to.equal(2);
      expect(sentEvents[0].eType).to.equal("load");
      expect(sentEvents[1].eType).to.equal("load");
      expect(sentEvents[0].componentReady).to.equal(true);
      expect(sentEvents[1].componentReady).to.equal(true);
    });
  });
  describe("#getRallyRequestId", () => {
    it("should find the RallyRequestId on an object", () => {
      const response = {
        getResponseHeader: {
          RallyRequestID: "myrequestid"
        }
      };
      expect(getRallyRequestId(response)).to.equal("myrequestid");
    });
    it("should find the RallyRequestId from a function", () => {
      const response = {
        getResponseHeader: sinon.stub().returns("myrequestid")
      };
      expect(getRallyRequestId(response)).to.equal("myrequestid");
      expect(response.getResponseHeader).to.have.been.calledWith("RallyRequestID");
    });
    it("should not find a RallyRequestId if there is no getResponseHeader", () => {
      const response = {};
      expect(getRallyRequestId(response)).to.be.undefined;
    });
    it("should not find a RallyRequestId if there getResponseHeader is something else", () => {
      const response = {
        getResponseHeader: 123
      };
      expect(getRallyRequestId(response)).to.be.undefined;
    });
    it("should find a RallyRequestID if there is a headers method", () => {
      const response = {
        headers: sinon.stub().returns("myrequestid")
      };
      expect(getRallyRequestId(response)).to.equal("myrequestid");
      expect(response.headers).to.have.been.calledWith("RallyRequestID");
    });
    it("should find a RallyRequestId if its passed in as a string", () => {
      expect(getRallyRequestId("ImARequestId")).to.equal("ImARequestId");
      expect(getRallyRequestId(123)).to.be.undefined;
    });
  });

  return describe('whenLongerThan parameter', () => {
    it("should not send the event if the duration is not longer than the 'whenLongerThan' parameter value", () => {
      const aggregator = createAggregatorAndRecordAction();
      sentEvents = [];
      const startTime = 50;
      const cmp = new Panel();
      aggregator.beginLoad({
        component: cmp,
        description: "a load",
        startTime: startTime
      });
      aggregator.endLoad({
        component: cmp,
        stopTime: startTime + 1000,
        whenLongerThan: 1000
      });
      expect(sentEvents.length).to.equal(0);
    });

    it("should send the event if the duration is longer than the 'whenLongerThan' parameter value", () => {
      const aggregator = createAggregatorAndRecordAction();
      sentEvents = [];
      const startTime = 50;
      const cmp = new Panel();
      aggregator.beginLoad({
        component: cmp,
        description: "a load",
        startTime: startTime
      });
      aggregator.endLoad({
        component: cmp,
        stopTime: startTime + 1001,
        whenLongerThan: 1000
      });
      expect(sentEvents.length).to.equal(1);
    });
  });
});
