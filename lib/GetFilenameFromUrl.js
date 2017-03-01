var pathJoin = require("./PathJoin");
var urlParse = require("url").parse;

// getFilenameFromUrl.bind(this, context.options.publicPath, context.compiler.outputPath);
// getFilenameFromUrl(options.publicPath || "/")
function getFilenameFromUrl(publicPath, outputPath, url) {
	var filename;
	// localPrefix is the folder our bundle should be in
	// 第二个参数如果为false那么查询字符串不会被decode或者解析
	// 第三个参数为true,那么//foo/bar被解析为{host: 'foo', pathname: '/bar'}，也就是第一个"//"后,'/'前解析为host
	// 如配置为 publicPath: "/assets/"将会得到下面的结果:
	/*
     Url {
	  protocol: null,
	  slashes: null,
	  auth: null,
	  host: null,
	  port: null,
	  hostname: null,
	  hash: null,
	  search: null,
	  query: null,
	  pathname: '/assets/
	  path: '/assets/',
	  href: '/assets/' 
	 }
	 */
	var localPrefix = urlParse(publicPath || "/", false, true);
	var urlObject = urlParse(url);
	//URL是http请求的真实路径,如http://localhost:1337/hello/world，那么req.url得到的就是/hello/world
	// publicPath has the hostname that is not the same as request url's, should fail
	// 访问的url的hostname和publicPath中配置的host不一致，直接返回。这只有在publicPath是绝对URL的情况下出现
	if(localPrefix.hostname !== null && urlObject.hostname !== null &&
		localPrefix.hostname !== urlObject.hostname) {
		return false;
	}
	// publicPath is not in url, so it should fail
	// publicPath和req.url必须一样
	if(publicPath && localPrefix.hostname === urlObject.hostname && url.indexOf(publicPath) !== 0) {
		return false;
	}
	// strip localPrefix from the start of url
	// 如果url中的pathname和publicPath一致，那么请求成功，文件名为urlObject中除去publicPath那一部分的结果
	// 如上面/hello/world表示req.url，而且publicPath为/hello/那么得到的文件名就是world
	if(urlObject.pathname.indexOf(localPrefix.pathname) === 0) {
		filename = urlObject.pathname.substr(localPrefix.pathname.length);
	}

	if(!urlObject.hostname && localPrefix.hostname &&
		url.indexOf(localPrefix.path) !== 0) {
		return false;
	}
	// and if not match, use outputPath as filename
	//如果有文件名那么从output.path中获取该文件，文件名为我们获取到的文件名。否则返回我们的outputPath
	//也就是说：如果没有filename那么我们直接获取到我们的output.path这个目录
	return filename ? pathJoin(outputPath, filename) : outputPath;

}

module.exports = getFilenameFromUrl;
