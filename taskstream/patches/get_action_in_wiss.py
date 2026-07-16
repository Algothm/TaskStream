import frappe


def execute():
	frappe.db.sql("""
        UPDATE `tabWork Item Score Summary`
        SET action = generated_from
        WHERE action is null or action = ''
    """)
