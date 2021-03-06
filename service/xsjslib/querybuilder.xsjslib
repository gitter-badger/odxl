/*
Copyright 2016 Just-BI BV, Roland Bouman (roland.bouman@just-bi.nl)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
(function(exports){
	
	function buildQuerySelectClause(req, parameters, query){
		query.push("SELECT");

		var select = parameters["$select"];
		if (select) {
			select = select.split(",");
			var i, n = select.length;
			for (i = 0; i < n; i++) {
				select[i] = sql.checkIdentifier(select[i], true);
			}
			select = parameters["$select"];
		}
		else {
			select = "*";
		}
		query.push(select);
	}
	
	function buildQueryFromClause(req, parameters, query){
		query.push("FROM");
		var tableName = req.tableName;
		var stmt = sql.checkIdentifier(tableName, true);
		var schemaName = req.schemaName;
		if (schemaName) {
			schemaName = sql.checkIdentifier(schemaName, true);
			stmt = schemaName + "." + stmt;
		}
		if (req.predicates) {
			var predicates = sql.createCalcViewPlaceholders(req.predicates);
			stmt += predicates;
		}
		query.push(stmt);
	}
	
	function odataFilterPrecedenceParser(filter){
		var tokenizer = new tokenizer.Tokenizer();
	}
	
	function translateFilterParseTreeToSql(node){
		var str = "";
		switch (node.type) {
			case "lparen":
				str = "(" + translateFilterParseTreeToSql(node.operand) + ")";
				break;
			case "multiplicative":
			case "additive":
			case "equality":
			case "relational":
			case "and":
			case "or":
				var left = node.leftOperand;
				var right = node.rightOperand;
				if (left.type === "nullliteral" || right.type === "nullliteral") {
					if (left.type === "nullliteral" && right.type === "nullliteral") {
						str = "/* null " + node.text + " null: */ ";
						if (node.text === "eq") {
							str += "1 = 1";
						}
						else {
							str += "1 != 1";
						}
					}
					else {
						if (left.type === "nullliteral") {
							str += translateFilterParseTreeToSql(right);
						}
						else
						if (right.type === "nullliteral"){
							str += translateFilterParseTreeToSql(left);
						}
						str += " IS NULL";
					}
				}
				else {
					var ops = {
					  "add": "+",
					  "sub": "-",
					  "mul": "*",
					  "div": "/",
					  "eq": "=",
					  "ne": "!=",
					  "gt": ">",
					  "ge": ">=",
					  "lt": "<",
					  "le": "<=",
					  "and": "AND",
					  "or": "OR",
					}
					left = translateFilterParseTreeToSql(left);
					right = translateFilterParseTreeToSql(right);
					if (node.text === "mod") {
						str = "MOD(" + left + ", " + right + ")";
					}
					else { 
						var op = ops[node.text];
						str = left + " " + op + " " + right;
					}
				}
				break;
			case "unary":
				str = node.text + translateFilterParseTreeToSql(node.rightOperand);
				break;
			case "funcSubstringOf":
				//TODO: verify that OData's subtringof() returns false if the second argument is empty
				//(because that's what we implemented with LOCATE https://help.sap.com/saphelp_hanaone/helpdata/en/20/e3b6b77519101485e6bd62f7018f75/content.htm)
				var needle = translateFilterParseTreeToSql(node.args[0]);
				var haystack = translateFilterParseTreeToSql(node.args[1]);
				str = "(IFNULL(LOCATE(" + haystack + ", " + needle + "), 0) != 0)";
				break;
			case "funcCheckWithSubstring":
				var haystack = translateFilterParseTreeToSql(node.args[0]);
				var needle = translateFilterParseTreeToSql(node.args[1]);
				switch (node.funcName) {
					case "endswith":
						str = "RIGHT(" + haystack + ", LENGTH(" + needle + ")) = " + needle; 
						break;
					case "startswith":
						str = "LEFT(" + haystack + ", LENGTH(" + needle + ")) = " + needle; 
						break;
					default:
						httpStatus = $.net.http.INTERNAL_SERVER_ERROR;
						throw "Unexpected error parsing OData expression: unexpected funcCheckWithSubstring \"" + node.funcName + "\".";
				}
				break;
			case "funcLength":
				var string = translateFilterParseTreeToSql(node.args[0]);
				str = "LENGTH(" + string + ")";
				break;
			case "funcIndexOf":
				var haystack = translateFilterParseTreeToSql(node.args[0]);
				var needle = translateFilterParseTreeToSql(node.args[1]);
				str = "(LOCATE(" + haystack + "," + needle + ") - 1)";
				break;
			case "funcReplace":
				var string = translateFilterParseTreeToSql(node.args[0]);
				var search = translateFilterParseTreeToSql(node.args[1]);
				var replace = translateFilterParseTreeToSql(node.args[2]);
				str = "REPLACE(" + string + ", " + search + ", " + replace + ")";
				break;
			case "funcSubstring":
				var string = translateFilterParseTreeToSql(node.args[0]);
				var pos = translateFilterParseTreeToSql(node.args[1]);
				str = "SUBSTRING(" + string + ", 1 + (" + pos + ")";
				if (node.args.length === 3) {
					var length = translateFilterParseTreeToSql(node.args[2]);
					str += ", " + length;
				}
				str += ")";
				break;
			case "funcConvertCase":
				var string = translateFilterParseTreeToSql(node.args[0]);
				switch (node.funcName){
					case "tolower":
						str = "LCASE(" + string + ")";
						break;
					case "toupper":
						str = "UCASE(" + string + ")";
						break;
					default:
						httpStatus = $.net.http.INTERNAL_SERVER_ERROR;
						throw "Unexpected error parsing OData expression: unexpected funcConvertCase \"" + node.funcName + "\".";
				}
				break;
			case "funcTrim":
				var string = translateFilterParseTreeToSql(node.args[0]);
				str = "TRIM(" + string + ")";
				break;
			case "funcConcat":
				var head = translateFilterParseTreeToSql(node.args[0]);
				var tail = translateFilterParseTreeToSql(node.args[1]);
				str = "CONCAT(" + head + ", " + tail + ")";
				break;
			case "funcDatetimePart":
				var datetime = translateFilterParseTreeToSql(node.args[0]);
				switch (node.funcName) {
					case "day":
						str = "DAYOFMONTH(" + datetime + ")";
						break;
					case "hour":
						str = "HOUR(" + datetime + ")";
						break;
					case "minute":
						str = "MINUTE(" + datetime + ")";
						break;
					case "month":
						str = "MONTH(" + datetime + ")";
						break;
					case "second":
						str = "SECOND(" + datetime + ")";
						break;
					case "year":
						str = "YEAR(" + datetime + ")";
						break;
				}
				break;
			case "funcRoundFloorCeiling":
				var num = translateFilterParseTreeToSql(node.args[0]);
				switch (node.funcName) {
					case "round":
						str = "ROUND(" + num + ")";
						break;
					case "floor":
						str = "FLOOR(" + num + ")";
						break;
					case "ceiling":
						str = "FLOOR(" + num + " + 1)";
						break;
					default:
						httpStatus = $.net.http.INTERNAL_SERVER_ERROR;
						throw "Unexpected error parsing OData expression: unexpected funcRoundFloorCeiling \"" + node.funcName + "\".";
				}
				break;
			case "identifier":
				str = sql.checkIdentifier(node.text);
				break;
			case "number":
			case "string":
				str = node.text;
				break;
		}
		return str;
	}
		
	function buildQueryWhereClause(req, parameters, query){
		var filter = parameters["$filter"];
		if (!filter) {
			return;
		}
		
		var odatafilterparser = $.import("odatafilterparser.xsjslib");
		var parser = new odatafilterparser.ODataFilterParser();
		
		query.push("WHERE");

		var parseTree = parser.parse(filter);
		query.push(translateFilterParseTreeToSql(parseTree));
	}
	
	function buildQueryOrderByClause(req, parameters, query){
		var orderby = parameters["$orderby"];
		if (!orderby) {
			return;
		}
		orderby = orderby.split(",")
		var i, n = orderby.length;
		for (i = 0; i < n; i++) {
			if (!/^\s*(\"[^\"]+\"|[_A-Z][A-Z0-9_#$]*)(\s+(asc|desc)\s*)?$/.test(orderby[i])) {
				error.raise("buildQuery", null, "Invalid orderby clause.");
			}
		}
		query.push("ORDER BY");
		query.push(parameters["$orderby"]);
	}
	
	function buildQueryLimitClause(req, parameters, query) {
		var top = parameters["$top"];
		var skip = parameters["$skip"];
		if (!top && !skip) {
			return;
		}
		query.push("LIMIT");
		if (top === undefined) {
			top = 1000;
		}
		query.push(top);
		if (!skip) {
			return;
		}
		query.push("OFFSET");
		query.push(skip);
	}
	
	function buildQuery(req, parameters){
		var query = [];

		buildQuerySelectClause(req, parameters, query);
		buildQueryFromClause(req, parameters, query);
		buildQueryWhereClause(req, parameters, query);
		buildQueryOrderByClause(req, parameters, query);
		buildQueryLimitClause(req, parameters, query);

		query = query.join("\n");
		//throw new Error(query);
		return query;
	}

	exports.buildQuery = buildQuery;
}(this));