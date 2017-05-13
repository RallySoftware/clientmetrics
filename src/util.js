export const createCorsXhr = (method, url) => {
  const xhr = new XMLHttpRequest();
  xhr.open(method, url, true);
  xhr.setRequestHeader('Content-type', 'application/json; charset=utf-8');
  return xhr;
};

export const omit = (obj, fields) => {
  if (!obj) {
    return {};
  }
  return Object.keys(obj).reduce((acc, key) => {
    if (fields.indexOf(key) === -1) {
      acc[key] = obj[key];
    }
    return acc;
  }, {});
};

export const assign = (dest, ...sources) => {
  sources.forEach(source => {
    if (typeof source !== 'object') {
      return;
    }
    Object.keys(source).forEach(key => {
      dest[key] = source[key]; // eslint-disable-line no-param-reassign
    });
  });
  return dest;
};

export const forEach = (arr, fn) => {
  for (let i = 0; i < arr.length; i += 1) {
    const result = fn(arr[i]);
    if (result === false) {
      return;
    }
  }
};
