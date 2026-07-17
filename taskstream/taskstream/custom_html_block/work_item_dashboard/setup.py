"""
Setup script — Creates / updates the "Work Item Dashboard" Custom HTML Block.

Usage:
    bench --site <your-site> execute taskstream.taskstream.custom_html_block.work_item_dashboard.setup.create_or_update_block
"""

import os

import frappe

BLOCK_NAME = "Work Item Dashboard"
DIR = os.path.dirname(os.path.abspath(__file__))


def create_or_update_block():
	html = _read("work_item_dashboard.html")
	style = _read("work_item_dashboard.css")
	script = _read("work_item_dashboard.js")

	if frappe.db.exists("Custom HTML Block", BLOCK_NAME):
		doc = frappe.get_doc("Custom HTML Block", BLOCK_NAME)
		doc.html = html
		doc.style = style
		doc.script = script
		doc.save()
	else:
		doc = frappe.new_doc("Custom HTML Block")
		doc.name = BLOCK_NAME
		doc.html = html
		doc.style = style
		doc.script = script
		doc.private = 0
		doc.insert()


def _read(filename):
	with open(os.path.join(DIR, filename)) as f:
		return f.read()
