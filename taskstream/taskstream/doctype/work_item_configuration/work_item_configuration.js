// Copyright (c) 2026, Chethan - Aerele and contributors
// For license information, please see license.txt

frappe.ui.form.on("Work Item Configuration", {
	refresh(frm) {
		if (frm.doc.reporting_frequency) {
			frm.set_df_property("reporting_frequency", "read_only", 1);
		}
		if (frm.doc.no_of_cycles_in_report) {
			frm.set_df_property("no_of_cycles_in_report", "read_only", 1);
		}
		if (frm.doc.starting_date) {
			frm.set_df_property("starting_date", "read_only", 1);
		}
	},
	penalty_points_per_day: function (frm) {
		frm.set_value("penalty_per_minute", frm.doc.penalty_points_per_day / 1440);
	},
});
