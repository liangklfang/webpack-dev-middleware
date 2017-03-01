function pathJoin(a, b) {
	//如果a是"/"那么直接把b相连接，否则将a和b通过"/"链接
	return a == "/" ? "/" + b : (a || "") + "/" + b;
}

module.exports = pathJoin;
