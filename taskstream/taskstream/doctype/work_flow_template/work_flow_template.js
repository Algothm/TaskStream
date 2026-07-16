// Copyright (c) 2026, Chethan - Aerele and contributors
// For license information, please see license.txt

frappe.ui.form.on("Work Flow Template", {
	refresh(frm) {
		if (frm.doc.docstatus && frm.doc.active) {
			frm.add_custom_button(__("Update Template"), function () {
				let doc = frappe.model.get_new_doc(frm.doc.doctype);
				doc.template_name = frm.doc.template_name;
				doc.version = updateVersion(frm.doc.version);
				doc.previous_template_version = frm.doc.name;

				(frm.doc.tasks || []).forEach((row) => {
					let child = frappe.model.add_child(doc, "tasks");
					child.task_name = row.task_name;
					child.task_description = row.task_description;
					child.assignee = row.assignee;
					child.target_end_date_time = row.target_end_date_time;
					child.target_end_duration = row.target_end_duration;
				});

				frappe.set_route("Form", frm.doc.doctype, doc.name);
			});
		}
	},
});

function updateVersion(version) {
	const match = version.match(/(\d+)(?!.*\d)/);

	if (match) {
		const lastNumber = match[0];
		const newNumber = parseInt(lastNumber, 10) + 1;

		return (
			version.substring(0, match.index) +
			newNumber +
			version.substring(match.index + lastNumber.length)
		);
	}
	return version + "1";
}
