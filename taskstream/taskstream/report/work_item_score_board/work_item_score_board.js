// Copyright (c) 2026, Chethan - Aerele and contributors
// For license information, please see license.txt

frappe.query_reports["Work Item Score Board"] = {
	filters: (function () {
		var f = [];
		if (frappe.user.has_role("System Manager") || frappe.user.has_role("Work Item Admin")) {
			f.push({
				fieldname: "user",
				label: __("User"),
				fieldtype: "Link",
				options: "User",
			});
		}
		return f;
	})(),
	formatter: function (value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (data && data.is_group) {
			value = `<strong>${value}</strong>`;
		}
		return value;
	},
};
