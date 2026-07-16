frappe.listview_settings["Work Item"] = {
	add_fields: ["seen_by_assignee"],
	get_indicator: function (doc) {
		if (!doc.status) return [__("No Status"), "grey", ""];
		switch (doc.status) {
			case "Open":
				if (doc.seen_by_assignee) {
					return [__("Open"), "blue", "status,=,Open"];
				}
				return [__("Open"), "grey", "status,=,Open"];
			case "Under Review":
				return [__("Under Review"), "orange", "status,=,Under Review"];
			case "Done":
				return [__("Done"), "green", "status,=,Done"];
			case "On Hold":
				return [__("On Hold"), "yellow", "status,=,On Hold"];
			case "Closed":
				return [__("Closed"), "blue", "status,=,Closed"];
			case "Unsuccessful":
				return [__("Unsuccessful"), "red", "status,=,Unsuccessful"];
			default:
				return [__(doc.status), "grey", ""];
		}
	},
};
