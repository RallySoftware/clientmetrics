import sinon from 'sinon';

const messageUtils = {
  expectedSpy(pass, spy, txt) {
    const not = pass ? 'not ' : '';
    const printf = spy.printf || sinon.spy.printf;
    return printf.call(spy, 'Expected spy "%n" %1%2', not, txt);
  },
  callCount(spy) {
    const printf = spy.printf || sinon.spy.printf;
    return printf.call(spy, '"%n" was called %c');
  },
  otherArgs(otherArgs) {
    if (!otherArgs || !otherArgs.length) {
      return '';
    } else if (otherArgs.length > 1) {
      return JSON.stringify(otherArgs);
    }
    return JSON.stringify(otherArgs[0]);
  },
};

const messageFactories = {
  spy(txt) {
    return function spy(pass, spyFn) {
      return `${messageUtils.expectedSpy(pass, spyFn, txt)}.`;
    };
  },
  spyWithCallCount(txt) {
    return function spyWithCallCount(pass, spy) {
      return `${messageUtils.expectedSpy(pass, spy, txt)}. ${messageUtils.callCount(spy)}.`;
    };
  },
  spyWithOtherArgs(txt) {
    return function spyWithOtherArgs(pass, spy, otherArgs) {
      return `${messageUtils.expectedSpy(pass, spy, txt)} ${messageUtils.otherArgs(otherArgs)}`;
    };
  },
};

const matchers = [
  {
    sinonName: 'called',
    jasmineName: 'toHaveBeenCalled',
    message: messageFactories.spyWithCallCount('to have been called'),
  },
  {
    sinonName: 'calledOnce',
    jasmineName: 'toHaveBeenCalledOnce',
    message: messageFactories.spyWithCallCount('to have been called once'),
  },
  {
    sinonName: 'calledTwice',
    jasmineName: 'toHaveBeenCalledTwice',
    message: messageFactories.spyWithCallCount('to have been called twice'),
  },
  {
    sinonName: 'calledThrice',
    jasmineName: 'toHaveBeenCalledThrice',
    message: messageFactories.spyWithCallCount('to have been called thrice'),
  },
  {
    sinonName: 'calledBefore',
    jasmineName: 'toHaveBeenCalledBefore',
    message: messageFactories.spyWithOtherArgs('to have been called before'),
  },
  {
    sinonName: 'calledAfter',
    jasmineName: 'toHaveBeenCalledAfter',
    message: messageFactories.spyWithOtherArgs('to have been called after'),
  },
  {
    sinonName: 'calledOn',
    jasmineName: 'toHaveBeenCalledOn',
    message: messageFactories.spyWithOtherArgs('to have been called on'),
  },
  {
    sinonName: 'alwaysCalledOn',
    jasmineName: 'toHaveBeenAlwaysCalledOn',
    message: messageFactories.spyWithOtherArgs('to have been always called on'),
  },
  {
    sinonName: 'calledWith',
    jasmineName: 'toHaveBeenCalledWith',
    message: messageFactories.spyWithOtherArgs('to have been called with'),
  },
  {
    sinonName: 'alwaysCalledWith',
    jasmineName: 'toHaveBeenAlwaysCalledWith',
    message: messageFactories.spyWithOtherArgs('to have been always called with'),
  },
  {
    sinonName: 'calledWithExactly',
    jasmineName: 'toHaveBeenCalledWithExactly',
    message: messageFactories.spyWithOtherArgs('to have been called with exactly'),
  },
  {
    sinonName: 'alwaysCalledWithExactly',
    jasmineName: 'toHaveBeenAlwaysCalledWithExactly',
    message: messageFactories.spyWithOtherArgs('to have been always called with exactly'),
  },
  {
    sinonName: 'calledWithMatch',
    jasmineName: 'toHaveBeenCalledWithMatch',
    message: messageFactories.spyWithOtherArgs('to have been called with match'),
  },
  {
    sinonName: 'alwaysCalledWithMatch',
    jasmineName: 'toHaveBeenAlwaysCalledWithMatch',
    message: messageFactories.spyWithOtherArgs('to have been always called with match'),
  },
  {
    sinonName: 'calledWithNew',
    jasmineName: 'toHaveBeenCalledWithNew',
    message: messageFactories.spy('to have been called with new'),
  },
  {
    sinonName: 'neverCalledWith',
    jasmineName: 'toHaveBeenNeverCalledWith',
    message: messageFactories.spyWithOtherArgs('to have been never called with'),
  },
  {
    sinonName: 'neverCalledWithMatch',
    jasmineName: 'toHaveBeenNeverCalledWithMatch',
    message: messageFactories.spyWithOtherArgs('to have been never called with match'),
  },
  {
    sinonName: 'threw',
    jasmineName: 'toHaveThrown',
    message: messageFactories.spyWithOtherArgs('to have thrown an error'),
  },
  {
    sinonName: 'alwaysThrew',
    jasmineName: 'toHaveAlwaysThrown',
    message: messageFactories.spyWithOtherArgs('to have always thrown an error'),
  },
  {
    sinonName: 'returned',
    jasmineName: 'toHaveReturned',
    message: messageFactories.spyWithOtherArgs('to have returned'),
  },
  {
    sinonName: 'alwaysReturned',
    jasmineName: 'toHaveAlwaysReturned',
    message: messageFactories.spyWithOtherArgs('to have always returned'),
  },
];

function createMatcher(matcher) {
  return function matcherFn(actual, expected, ...args) {
    const sinonProperty = actual[matcher.sinonName];

    let pass;
    if (typeof sinonProperty === 'function') {
      pass = sinonProperty.apply(actual, [expected, ...args]);
    } else {
      pass = sinonProperty;
    }

    return {
      pass: !!pass,
      message: matcher.message(!!pass, actual, args),
    };
  };
}

function createJasmineSinonMatchers(matchers) {
  return matchers.reduce((result, matcher) => {
    result[matcher.jasmineName] = createMatcher(matcher);
    return result;
  }, {});
}

export default createJasmineSinonMatchers(matchers);
