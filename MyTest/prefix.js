var urlParse = require("url").parse;
var localPrefix = urlParse("/assets/" || "/", false, true);
console.log("localPrefix:",localPrefix);