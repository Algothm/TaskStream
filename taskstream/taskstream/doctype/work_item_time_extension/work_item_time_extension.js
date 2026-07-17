// Copyright (c) 2026, Chethan - Aerele and contributors
// For license information, please see license.txt

frappe.ui.form.on("Work Item Time Extension", {
	refresh(frm) {
		const { user } = frappe.session;
		const approver_rows = frm.doc.approver || [];
		const is_current_user_approver = approver_rows.some((row) => row.user === user);
		const isAdmin =
			frappe.user.has_role("Administrator") || frappe.user.has_role("Work Item Admin");

		const set_status = (status) => {
			if (frm.is_dirty()) {
				frappe.throw(__("Please save the document before updating the status."));
				return;
			}
			frappe.call({
				method: "taskstream.taskstream.doctype.work_item_time_extension.work_item_time_extension.update_status",
				args: {
					docname: frm.doc.name,
					status,
				},
				callback: function (r) {
					if (!r.exc) {
						frm.reload_doc();
					}
				},
			});
		};

		if (frm.doc.status === "Pending" && (is_current_user_approver || isAdmin)) {
			frm.set_df_property("do_not_impact_score", "read_only", 0);
			frm.add_custom_button(__("Approve"), () => set_status("Approved"));
			frm.add_custom_button(__("Reject"), () => set_status("Rejected"));
		}
	},
});
