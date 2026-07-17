import frappe


def execute():
	frappe.db.sql(
		"""
    UPDATE `tabWork Item Score Summary`
    SET action = CASE
        WHEN action = "Reporting Window" THEN "Scheduled Job"
        WHEN action = "Work Item" THEN "Work Item Update"
        ELSE action
    END
    WHERE action IN ("Reporting Window", "Work Item")
    """
	)
