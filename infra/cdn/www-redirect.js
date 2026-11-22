// CloudFront Function (cloudfront-js-2.0) on viewer request. A request for www.<apex> gets a 301 to
// the same path and query on https://<apex>; every other request passes through untouched. The
// redirect is here rather than in Next because CloudFront sends the origin the function URL's own
// host. cdn.tf fills in the apex name on the next line.
var APEX = 'APEX_HOST';

// The query string as CloudFront received it, repeated names included, in order
function query(qs) {
  var parts = [];
  for (var name in qs) {
    var entry = qs[name];
    var values = entry.multiValue ? entry.multiValue : [entry];
    for (var i = 0; i < values.length; i++) {
      parts.push(values[i].value === '' ? name : name + '=' + values[i].value);
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : '';
  if (host !== 'www.' + APEX) {
    return request;
  }
  // The location's host is fixed: the URI always starts with "/", so nothing in the request can
  // move the redirect to another site. CloudFront adds no headers to a response a function makes,
  // so it carries the app's HSTS itself.
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: 'https://' + APEX + request.uri + query(request.querystring) },
      'strict-transport-security': { value: 'max-age=63072000; includeSubDomains; preload' },
    },
  };
}
