import WindowErrorListener from '../windowErrorListener';
import { stub } from '../../test-utils/specHelper';

describe('WindowErrorListener', () => {
  let aggregator, originalOnError;
  const message = 'uhoh';
  const filename = 'file.js';
  const lineno = 22;
  const colno = 13;

  const createListener = config => {
    return new WindowErrorListener(aggregator, true, config);
  };

  beforeEach(() => {
    originalOnError = window.onerror = stub();
    aggregator = {
      recordError: stub(),
    };
  });

  afterEach(() => {
    window.onerror = originalOnError;
  });

  it('should record the error message, file and line number', () => {
    createListener();
    window.onerror(message, filename, lineno);
    expect(aggregator.recordError).toHaveBeenCalledWith(`${message}, ${filename}:${lineno}`, {});
  });

  it('should pass column number and stack trace if available', () => {
    createListener();
    window.onerror(message, filename, lineno, colno);
    expect(aggregator.recordError.args[0][1]).toEqual({
      columnNumber: colno,
    });
    const stack = 'stack trace';
    window.onerror(message, filename, lineno, colno, { stack });
    expect(aggregator.recordError.args[1][1]).toEqual({
      columnNumber: colno,
      stack,
    });
  });

  it('should gracefully deal with no error message, file and line number', () => {
    createListener();
    window.onerror({});
    const errorInfo = aggregator.recordError.args[0][0];
    expect(errorInfo).not.toContain('undefined');
    expect(errorInfo).toContain('?');
  });

  it('should maintain the existing window.onerror', () => {
    createListener();
    window.onerror(message, filename, lineno);
    expect(aggregator.recordError).toHaveBeenCalledWith(`${message}, ${filename}:${lineno}`);
    expect(originalOnError).toHaveBeenCalledWith(message, filename, lineno);
  });
});
