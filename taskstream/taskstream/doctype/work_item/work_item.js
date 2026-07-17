// Copyright (c) 2025, Chethan - Aerele and contributors
// For license information, please see license.txt

frappe.ui.form.on("Work Item", {
	onload: function (frm) {
		if (frm.is_new() && !frm.doc.reporter) {
			frm.set_value("reporter", frappe.session.user);
			frm.set_value("requester", frappe.session.user);
		}
		if (frm.is_new() && !frm.doc.target_end_date) {
			frm.set_value("target_end_date", `${frappe.datetime.get_today()} 23:59:59`);
		}
	},

	onload_post_render(frm) {
		reinit_datetime_pickers(frm);
	},

	refresh: function (frm) {
		if (frm.page.actions) {
			frm.page.actions
				.find(".menu-item-label")
				.filter(function () {
					return [
						__("Sent Mail"),
						__("Rework"),
						__("Hold"),
						__("Resume"),
						__("Request Time Extension"),
						__("Reassign"),
						__("Cancel"),
					].includes($(this).text().trim());
				})
				.closest("li")
				.remove();
		}

		mark_seen_by_assignee(frm);
		setup_voice_to_text(frm);
		reinit_datetime_pickers(frm);
		frm.page.sidebar.hide();
		$(frm.page.wrapper).find(".sidebar-toggle-btn").hide();
		setup_two_col_layout(frm);
		render_wi_score_badge(frm);
		set_wft_tasks(frm, frm.doc.work_flow_template);
		setTimeout(() => sync_overview_label(frm), 0);
		const { user } = frappe.session;
		const isAdmin =
			frappe.user.has_role("Administrator") || frappe.user.has_role("Work Item Admin");
		const isDone = ["Done", "Cancelled", "Unsuccessful", "Closed"].includes(frm.doc.status);
		//hide benefit_of_work_done if form is new
		if (frm.is_new()) {
			frm.set_df_property("benefit_of_work_done", "hidden", 1);
		}
		// Mark Complete button
		if (
			(frm.doc.status === "Open" && !frm.doc.review_required && user === frm.doc.assignee) ||
			(frm.doc.status === "Under Review" && user === frm.doc.reviewer)
		) {
			frm.add_custom_button(__("Mark Complete"), function () {
				frappe.confirm(
					__("Are you sure you want to mark this item as complete?"),
					function () {
						frappe.call({
							method: "taskstream.taskstream.doctype.work_item.work_item.mark_complete",
							args: { docname: frm.doc.name },
							freeze: true,
							freeze_message: __("Applying updates..."),
							callback: function (r) {
								if (!r.exc) {
									frappe.msgprint(__("Marked as Done!"));
									frm.reload_doc();
								}
							},
						});
					}
				);
			})
				.removeClass("btn-default")
				.addClass("btn-primary");
		}
		// Send Notification button
		if (
			// !frm.doc.first_mail &&
			!frm.is_dirty() &&
			frm.doc.status === "Open" &&
			(user === frm.doc.reporter || user === frm.doc.requester)
		) {
			frm.page.add_action_item(__("Sent Mail"), function () {
				frappe.call({
					method: "taskstream.utils.sent_noti",
					args: { work_item: frm.doc.name },
					callback: function (r) {
						if (!r.exc) {
							frappe.msgprint(__("Mail Sent!"));
							frm.reload_doc();
						}
					},
				});
			});
		}
		// Rework button
		if (frm.doc.status === "Under Review" && frm.doc.reviewer === user) {
			frm.page.add_action_item(__("Rework"), function () {
				let d = new frappe.ui.Dialog({
					title: "Rework Work Item",
					fields: [
						{
							label: "Rework Comments",
							fieldname: "rework_comments",
							fieldtype: "Small Text",
							reqd: 1,
						},
						{
							label: "Target End Date",
							fieldname: "target_end_date",
							fieldtype: "Datetime",
						},
					],
					primary_action_label: "Submit",
					primary_action(values) {
						frappe.call({
							method: "taskstream.taskstream.doctype.work_item.work_item.resend_for_rework",
							args: {
								docname: frm.doc.name,
								rework_comments: values.rework_comments,
								target_end_date: values.target_end_date || null,
							},
							callback: function (r) {
								if (!r.exc) {
									frappe.msgprint(__("Work Item sent for rework!"));
									frm.reload_doc();
									d.hide();
								}
							},
						});
					},
				});
				d.show();
			});
		}
		// Start Now Button
		// if (!frm.is_new() && frm.doc.status === "To Do" && frm.doc.assignee === user) {
		// 	frm.add_custom_button(__("Start Now"), function () {
		// 		frappe.call({
		// 			method: "taskstream.taskstream.doctype.work_item.work_item.start_now",
		// 			args: { docname: frm.doc.name },
		// 			callback: function (r) {
		// 				if (!r.exc) {
		// 					frappe.msgprint(__("Work Item started!"));
		// 					frm.reload_doc();
		// 				}
		// 			},
		// 		});
		// 	});
		// }
		//Hold Button
		if (frm.doc.status === "Open" && frm.doc.assignee === user) {
			frm.page.add_action_item(__("Hold"), function () {
				frappe.db.set_value("Work Item", frm.doc.name, "status", "On Hold").then(() => {
					frappe.msgprint(__("Work Item put on hold!"));
					frm.reload_doc();
				});
			});
		}
		//Resume Button
		if (frm.doc.status === "On Hold" && frm.doc.assignee === user) {
			frm.page.add_action_item(__("Resume"), function () {
				frappe.db.set_value("Work Item", frm.doc.name, "status", "Open").then(() => {
					frappe.msgprint(__("Work Item resumed!"));
					frm.reload_doc();
				});
			});
		}
		// Send for Review button
		if (!frm.is_new() && ["Open", "Under Review"].includes(frm.doc.status)) {
			const iscritical = frm.doc.review_required;

			if (iscritical && user === frm.doc.assignee && frm.doc.status == "Open") {
				frm.add_custom_button(__("Send for Review"), function () {
					frappe.call({
						method: "taskstream.taskstream.doctype.work_item.work_item.send_for_review",
						args: {
							docname: frm.doc.name,
							reviewer: frm.doc.reviewer,
						},
						callback: function (r) {
							if (!r.exc) {
								frappe.msgprint(__("Sent for review!"));
								frm.reload_doc();
							}
						},
					});
				});
			}
		}
		//Time extension button
		if (frm.doc.status === "Open" && frm.doc.assignee === user) {
			frm.page.add_action_item(__("Request Time Extension"), function () {
				let d = new frappe.ui.Dialog({
					title: "Request Time Extension",
					fields: [
						{
							label: "Requested Target Date and Time",
							fieldname: "req_target_date_time",
							fieldtype: "Datetime",
							reqd: 1,
							default: frm.doc.target_end_date,
						},
						{
							label: "Reason",
							fieldname: "reason",
							fieldtype: "Small Text",
							reqd: 1,
						},
					],
					primary_action_label: "Submit",
					primary_action(values) {
						frappe.call({
							method: "taskstream.taskstream.doctype.work_item.work_item.time_extension_request",
							args: {
								doc: frm.doc.name,
								reason: values.reason,
								req_target_date_time: values.req_target_date_time,
							},
							freeze: true,
							callback: function (r) {
								if (!r.exc) {
									frm.reload_doc();
									d.hide();
									const message =
										(r.message && r.message.message) ||
										"Time Extension Requested";
									frappe.show_alert({
										message: message,
										indicator: "green",
									});
								}
							},
						});
					},
				});
				d.show();
			});
		}
		// Set Read Only for non reporter and non requester
		if (
			!isAdmin &&
			(isDone ||
				(!frm.is_new() &&
					// (frm.doc.first_mail == 1 ||
					user !== frm.doc.reporter &&
					user !== frm.doc.requester)) //)
		) {
			const fieldnames = frm.meta.fields.map((f) => f.fieldname).filter(Boolean);
			fieldnames.forEach((field) => {
				if (field === "attachments" && !isDone) return;
				frm.set_df_property(field, "read_only", 1);
			});
		}
		//Reassignment
		const approved_users_for_reassignment = [
			frm.doc.assignee,
			frm.doc.reporter,
			frm.doc.requester,
		];
		if (
			frm.doc.status === "Open" &&
			approved_users_for_reassignment.includes(user) &&
			!frm.is_new()
		) {
			frm.page.add_action_item(__("Reassign"), function () {
				let d = new frappe.ui.Dialog({
					title: "Reassignment",
					fields: [
						{
							label: "Current Assignee",
							fieldname: "current_assignee",
							fieldtype: "Link",
							options: "User",
							read_only: 1,
							default: frm.doc.assignee,
						},
						{
							label: "Assign To",
							fieldname: "new_assignee",
							fieldtype: "Link",
							options: "User",
							reqd: 1,
						},
						{
							label: "Reason/Remarks",
							fieldname: "reason",
							fieldtype: "Small Text",
							reqd: 1,
						},
					],
					primary_action_label: "Submit",
					primary_action(values) {
						frappe.call({
							method: "taskstream.taskstream.doctype.work_item.work_item.reassign",
							args: {
								wi: frm.doc.name,
								new_assignee: values.new_assignee,
								current_assignee: values.current_assignee,
								reason: values.reason,
							},
							callback: function (r) {
								if (!r.exc) {
									frappe.set_route("List", "Work Item");
								}
							},
						});
						d.hide();
					},
				});
				d.show();
			});
		}
		if (
			["Open", "Under Review"].includes(frm.doc.status) &&
			!frm.is_new() &&
			(isAdmin ||
				user === frm.doc.reporter ||
				user === frm.doc.requester ||
				user === frm.doc.reviewer)
		) {
			frm.page.add_action_item(__("Cancel"), function () {
				frappe.db.set_value("Work Item", frm.doc.name, "status", "Cancelled").then(() => {
					frm.reload_doc();
				});
			});
		}
		//edit-able condition for benefit_of_work_done
		if (frm.doc.review_required && user === frm.doc.reviewer) {
			frm.set_df_property("benefit_of_work_done", "read_only", 0);
		} else if (
			!frm.doc.review_required &&
			(user === frm.doc.reporter || user === frm.doc.requester)
		) {
			frm.set_df_property("benefit_of_work_done", "read_only", 0);
		} else {
			frm.set_df_property("benefit_of_work_done", "read_only", 1);
		}

		// Ensure Actions dropdown is standard white
		setTimeout(() => {
			if (frm.page.actions_btn_group) {
				frm.page.actions_btn_group
					.find("button")
					.removeClass("btn-primary")
					.addClass("btn-default");
			}
		}, 50);
		_setup_compact_benefit_row(frm);
	},

	work_flow: function (frm) {
		if (frm.doc.work_flow) {
			set_active_tab(frm, "work_flow_tab", "Work Flow");
			frm.set_value("target_end_date", null);
			frm.set_value("assignee", null);
			frm.set_df_property("target_end_date", "read_only", 1);
			frm.set_df_property("assignee", "read_only", 1);
		} else {
			set_active_tab(frm, "details_tab", "Overview");
			frm.set_value("target_end_date", `${frappe.datetime.get_today()} 23:59:59`);
			frm.set_df_property("target_end_date", "read_only", 0);
			frm.set_df_property("assignee", "read_only", 0);
			empty_fields(frm, [
				"start_date_time",
				"work_flow_template",
				"html_aseg",
				"summary",
				"description",
				"assignee",
			]);
		}
		setTimeout(() => sync_overview_label(frm), 0);
	},

	review_required: function (frm) {
		if (frm.doc.review_required && !frm.doc.reviewer) {
			frm.set_df_property("reviewer", "reqd", frm.doc.review_required);
		}
		if (!frm.doc.review_required) {
			frm.set_value("reviewer", null);
		}
		frm.refresh_field("reviewer");
	},

	reviewer: function (frm) {
		if (frm.doc.reviewer) {
			if (frm.doc.reviewer == frm.doc.assignee) {
				frappe.throw("Reviewer cannot be same as the Assignee");
			}
		}
	},

	assignee: function (frm) {
		if (frm.doc.assignee) {
			if (frm.doc.reviewer == frm.doc.assignee) {
				frappe.throw("Assignee cannot be same as the Reviewer");
			}
		}
	},

	attachment: async function (frm) {
		let file_url = frm.doc.attachment;
		if (!file_url) return;

		const r = await frappe.db.get_value("File", { file_url: file_url }, ["name", "file_size"]);
		const file_doc = r?.message;
		if (!file_doc) return;

		const max_size = await frappe.db.get_single_value(
			"Work Item Configuration",
			"max_file_attachment_size"
		);
		const allowed_size = max_size;

		const size_mb = file_doc.file_size / (1024 * 1024);

		if (size_mb > allowed_size) {
			frappe.call({
				method: "taskstream.api.delete_file_if_exists",
				args: {
					file_name: file_doc.name,
				},
				callback: function () {
					frm.set_value("attachment", "");
					frappe.msgprint(__(`File must be less than ${allowed_size} MB`));
				},
			});
		}
	},

	work_flow_template(frm) {
		setup_work_flow_template(frm);
		set_target_end_date_time(frm);
		set_wft_tasks(frm, frm.doc.work_flow_template);
	},

	start_date_time(frm) {
		set_target_end_date_time(frm);
	},

	scenario(frm) {
		set_active_tab(frm, "details_tab", "Details");
	},
});

frappe.ui.form.on("Work Item Attachment", {
	before_attachments_remove: function (frm, cdt, cdn) {
		const { user } = frappe.session;
		const row = locals[cdt][cdn];
		const isAdmin =
			frappe.user.has_role("Administrator") || frappe.user.has_role("Work Item Admin");

		if (
			isAdmin ||
			user === frm.doc.reporter ||
			user === frm.doc.requester ||
			user === frm.doc.assignee
		) {
			return;
		}

		if (row && row.owner === user) {
			return;
		}

		frappe.throw(
			__(
				"Only the reporter/requester/assignee or the attachment owner can delete this attachment"
			)
		);
	},
});

function mark_seen_by_assignee(frm) {
	const { user } = frappe.session;
	if (
		frm.is_new() ||
		frm.doc.seen_by_assignee ||
		!frm.doc.assignee ||
		frm.doc.assignee !== user ||
		frm.doc.assignee === frm.doc.reporter
	) {
		return;
	}
	frappe.call({
		method: "taskstream.taskstream.doctype.work_item.work_item.mark_seen_by_assignee",
		args: { docname: frm.doc.name },
		callback: function (r) {
			if (!r.exc) {
				frm.doc.seen_by_assignee = 1;
				frm.doc.seen_by_assignee_on = frappe.datetime.now_datetime();
				frm.refresh_field("seen_by_assignee");
				frm.refresh_field("seen_by_assignee_on");
			}
		},
	});
}

function setup_voice_to_text(frm) {
	const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
	const field = frm.fields_dict.summary;
	if (!SpeechRecognition || !field || field._voice_btn) return;

	voice_to_text_inject_styles();

	const $input_wrapper = field.$wrapper.find(".control-input-wrapper .control-input");
	if (!$input_wrapper.length) return;

	const $btn = $(`
		<button type="button" class="wi-voice-btn" title="${__("Click to dictate Summary")}">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
				<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
				<line x1="12" y1="19" x2="12" y2="23"></line>
				<line x1="8" y1="23" x2="16" y2="23"></line>
			</svg>
		</button>
	`);
	$input_wrapper.css("position", "relative").append($btn);
	field._voice_btn = $btn;

	let recognition = null;
	let listening = false;
	let base_text = "";

	const stop_listening = () => {
		listening = false;
		$btn.removeClass("listening");
		if (recognition) {
			recognition.onend = null;
			recognition.stop();
		}
	};

	$btn.on("click", function (e) {
		e.preventDefault();
		e.stopPropagation();

		if (listening) {
			stop_listening();
			return;
		}

		base_text = frm.doc.summary || "";
		recognition = new SpeechRecognition();
		recognition.lang = frappe.boot.lang || "en-US";
		recognition.continuous = true;
		recognition.interimResults = true;

		recognition.onresult = (event) => {
			let final_chunk = "";
			let interim_chunk = "";
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const transcript = event.results[i][0].transcript;
				if (event.results[i].isFinal) {
					final_chunk += transcript + " ";
				} else {
					interim_chunk += transcript;
				}
			}
			if (final_chunk) {
				base_text = (base_text ? base_text.trim() + " " : "") + final_chunk.trim();
			}
			frm.set_value("summary", ((base_text ? base_text + " " : "") + interim_chunk).trim());
		};

		recognition.onerror = (event) => {
			console.error("Work Item voice-to-text error:", event.error);
			// 'no-speech' just means it timed out waiting for you to talk — benign in
			// continuous mode, onend will restart it. Everything else is fatal.
			if (event.error !== "no-speech") {
				frappe.show_alert({
					message: __("Voice input stopped: {0}", [event.error]),
					indicator: "red",
				});
				stop_listening();
			}
		};

		recognition.onend = () => {
			// Chrome's continuous mode still stops after a pause in speech; keep it alive.
			if (listening) recognition.start();
		};

		listening = true;
		$btn.addClass("listening");
		try {
			recognition.start();
		} catch (err) {
			console.error("Work Item voice-to-text failed to start:", err);
			stop_listening();
		}
	});
}

function voice_to_text_inject_styles() {
	if (document.getElementById("wi-voice-btn-style")) return;
	$("head").append(`<style id="wi-voice-btn-style">
		.wi-voice-btn {
			position: absolute;
			top: 6px;
			right: 6px;
			width: 24px;
			height: 24px;
			display: flex;
			align-items: center;
			justify-content: center;
			border: none;
			border-radius: 50%;
			background: var(--btn-default-bg, #f4f5f6);
			color: var(--text-muted);
			cursor: pointer;
			transition: background 0.15s, color 0.15s;
			z-index: 2;
		}
		.wi-voice-btn:hover {
			background: var(--gray-200, #e2e6ea);
			color: var(--text-color);
		}
		.wi-voice-btn.listening {
			background: #ff4d4f;
			color: #fff;
			animation: wi-voice-pulse 1.4s ease-in-out infinite;
		}
		@keyframes wi-voice-pulse {
			0% { box-shadow: 0 0 0 0 rgba(255, 77, 79, 0.5); }
			70% { box-shadow: 0 0 0 8px rgba(255, 77, 79, 0); }
			100% { box-shadow: 0 0 0 0 rgba(255, 77, 79, 0); }
		}
	</style>`);
}

function get_target_end_datetime(duration, base_datetime) {
	const [hours = 0, minutes = 0, seconds = 0] = String(duration || "00:00:00")
		.split(":")
		.map((value) => parseInt(value, 10) || 0);

	let target = moment(base_datetime || undefined)
		.add(hours, "hours")
		.add(minutes, "minutes")
		.add(seconds, "seconds")
		.seconds(0)
		.milliseconds(0);

	return target.format("YYYY-MM-DD HH:mm:ss");
}

function set_target_end_date_time(frm) {
	if (!frm.doc.start_date_time || !frm.doc.work_flow_template) return;
	frappe.call({
		method: "taskstream.taskstream.doctype.work_item.work_item.update_target_end_on_start_date_change",
		args: {
			work_flow_template: frm.doc.work_flow_template,
			start_date_time: frm.doc.start_date_time,
		},
		callback: function (r) {
			if (!r.exc && r.message) {
				// let first_activity = (frm.doc.activities || [])[0];

				// if (!first_activity) {
				// 	first_activity = frm.add_child("activities");
				// 	first_activity.action_type = "Target End Date";
				// }

				// frappe.model.set_value(
				// 	first_activity.doctype,
				// 	first_activity.name,
				// 	"time",
				// 	r.message
				// );
				// frm.refresh_field("activities");

				frm.set_value("target_end_date", r.message);
			}
		},
	});
}

function setup_work_flow_template(frm) {
	if (frm.doc.work_flow_template) {
		frappe.call({
			method: "taskstream.taskstream.doctype.work_item.work_item.get_wft_data",
			args: {
				wft: frm.doc.work_flow_template,
			},
			callback: function (r) {
				if (!r.exc) {
					frm.set_value("assignee", r.message.assignee);
					frm.set_value("summary", r.message.task_name);
					frm.set_value("description", r.message.task_description);
				}
			},
		});
	}
}

function setup_two_col_layout(frm) {
	const SIDEBAR_SECTIONS = [
		"section_break_iwoa",
		"people_section",
		"settings_section",
		"section_break_maby",
	];
	const WRAP_CLASS = "wi-global-wrap";
	const MAIN_CLASS = "wi-main-content";
	const SIDE_CLASS = "wi-side-bar";

	function applyLayout() {
		let $wrapper = $(frm.wrapper);
		let $wrap = $wrapper.find("." + WRAP_CLASS);

		if (!$wrap.length) {
			let $formLayout = $wrapper.find(".form-layout");
			if (!$formLayout.length) {
				$formLayout = $wrapper.find(".layout-main-section");
			}
			if (!$formLayout.length) return;

			$wrap = $("<div>").addClass(WRAP_CLASS);
			let $mainContent = $("<div>").addClass(MAIN_CLASS);
			let $sideBar = $("<div>").addClass(SIDE_CLASS);

			$formLayout.children().appendTo($mainContent);
			$wrap.append($mainContent).append($sideBar);
			$formLayout.append($wrap);
		}

		let $sideBar = $wrapper.find("." + SIDE_CLASS);

		$wrapper.find(".form-section").each(function () {
			let fieldname = $(this).attr("data-fieldname");
			if (SIDEBAR_SECTIONS.includes(fieldname)) {
				if ($(this).parent()[0] !== $sideBar[0]) {
					$sideBar.append(this);
				}
			}
		});
	}

	if (!frm.layout._wi_refresh_patched) {
		frm.layout._wi_refresh_patched = true;
		const orig_refresh = frm.layout.refresh_sections;
		frm.layout.refresh_sections = function () {
			orig_refresh.apply(this, arguments);

			$(frm.wrapper)
				.find("." + WRAP_CLASS + " .form-section:not(.hide-control)")
				.each(function () {
					const $sec = $(this);
					if (!$sec.find(".frappe-control:not(.hide-control)").length) {
						$sec.addClass("empty-section");
					} else {
						$sec.removeClass("empty-section");
					}
				});

			setTimeout(applyLayout, 0);
		};
	}

	setTimeout(applyLayout, 50);
	setTimeout(applyLayout, 200);
}

function set_active_tab(frm, tab_name, tab_label) {
	const detailsTab = (frm.layout?.tabs || []).find(
		(t) => t.df && (t.df.fieldname === tab_name || t.label === tab_label)
	);
	if (detailsTab) {
		detailsTab.set_active();
	}
}

function sync_overview_label(frm) {
	const tabs = frm.layout?.tabs || [];
	const visible = tabs.filter((t) => t.tab_link && t.tab_link.is(":visible")).length;
	const label = $(frm.fields_dict["basic_details_section"].wrapper).find(".section-head");
	label.toggle(visible <= 1);
}

if (!document.getElementById("wi-overview-section-style")) {
	const style = document.createElement("style");
	style.id = "wi-overview-section-style";
	style.textContent = `
		[data-fieldname="basic_details_section"] .section-head {
			font-size: 15px;
			font-weight: 600;
			color: var(--text-color);
			padding: 8px 0 4px;
			padding-left: 15px;
			border-bottom: none;
			text-transform: none;
			letter-spacing: normal;
			margin-bottom: 0;
		}
	`;
	document.head.appendChild(style);
}

function set_wft_tasks(frm, wft) {
	const isDone = ["Done", "Cancelled", "Unsuccessful", "Closed"].includes(frm.doc.status);
	if (!wft) {
		if (frm.fields_dict.html_aseg && frm.fields_dict.html_aseg.$wrapper) {
			frm.fields_dict.html_aseg.$wrapper.html("");
		}
		return;
	}

	frappe.call({
		method: "taskstream.api.get_all_work_flow_template_tasks",
		args: { wft },
		callback: function (r) {
			if (!r.exc && r.message) {
				const tasks = r.message;
				tasks.sort((a, b) => (a.idx || 0) - (b.idx || 0));

				const wft_map = {};
				let last_task_idx = 0;
				(frm.doc.work_flow_tasks || []).forEach((row) => {
					if (row.task_idx && row.work_item) {
						wft_map[row.task_idx] = row.work_item;
						if (row.task_idx > last_task_idx) {
							last_task_idx = row.task_idx;
						}
					}
				});

				let current_idx = frm.doc.idx || 0;

				const getStatus = (t) => {
					if (t.idx < last_task_idx) {
						return "done";
					} else if (t.idx === last_task_idx) {
						if (t.idx === current_idx && ["Done", "Closed"].includes(frm.doc.status)) {
							return "done";
						}
						return "active";
					} else {
						return "upcoming";
					}
				};

				const formatDur = (secs) => {
					const s = parseInt(secs) || 0;
					const d = Math.floor(s / 86400);
					const h = Math.floor((s % 86400) / 3600);
					const m = Math.floor((s % 3600) / 60);
					return (
						[d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ") || ""
					);
				};

				const formatDate = (dt) => {
					if (!dt) return "";
					const d = new Date(dt);
					if (isNaN(d)) return "";
					const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
					const time = d.toLocaleTimeString("en-GB", {
						hour: "2-digit",
						minute: "2-digit",
						hour12: false,
					});
					return `${date}, ${time}`;
				};

				wi_flow_inject_styles();

				const activeStartDate = formatDate(frm.doc.start_date_time);

				let rows = "";
				tasks.forEach((t, i) => {
					const status = getStatus(t);
					const isLast = i === tasks.length - 1;
					const isDoneStatus = status === "done";
					const isActive = status === "active";
					const isUpcoming = status === "upcoming";

					const dur = formatDur(t.target_end_duration);
					const linked_wi = wft_map[t.idx] || "";

					let assignee_name = frappe.user?.full_name
						? frappe.user.full_name(t.assignee)
						: t.assignee;
					if (!assignee_name && t.assignee) assignee_name = t.assignee;

					const resolvedName = assignee_name;
					const isEmailFallback = resolvedName === t.assignee;
					const assignee = isEmailFallback
						? (t.assignee || "")
								.split("@")[0]
								.replace(/[._]/g, " ")
								.replace(/\b\w/g, (c) => c.toUpperCase())
						: resolvedName || "";
					const isMyTask = isActive && t.assignee === frappe.session.user;

					let timePart = "";
					if (isDoneStatus) {
						timePart = "Completed";
						if (t.idx === current_idx && frm.doc.actual_end_date) {
							timePart = "Completed " + formatDate(frm.doc.actual_end_date);
						}
					} else if (isActive && activeStartDate) {
						timePart = "Started " + activeStartDate;
					} else if (isUpcoming && dur) {
						timePart = "~" + dur;
					}

					const circleClass =
						"wi-fp-circle " +
						(isDoneStatus ? "wfc-done" : isActive ? "wfc-active" : "wfc-upcoming");
					const lineClass =
						"wi-fp-line " +
						(isDoneStatus ? "wfl-done" : isActive ? "wfl-active" : "wfl-upcoming");

					const metaParts = [assignee, timePart].filter(Boolean).join(" &middot; ");

					let cardHtml = "";
					if (isUpcoming) {
						cardHtml = `
							<div class="wi-fp-ghost">
								<div class="wi-fp-ghost-title">${t.task_name || ""}</div>
								<div class="wi-fp-ghost-meta">${metaParts}</div>
								<span class="wi-fp-badge wfb-upcoming">UPCOMING</span>
							</div>`;
					} else {
						const isClickable = t.idx !== current_idx && linked_wi;
						cardHtml = `
							<div class="wi-fp-card ${isDoneStatus ? "wfc-card-done" : "wfc-card-active"}${
							isClickable ? " wi-fp-clickable" : ""
						}"${isClickable ? ` data-work-item="${linked_wi}"` : ""}>
								<div class="wi-fp-card-main">
									<div class="wi-fp-card-top">
										${linked_wi ? `<span class="wi-fp-wi-id">${linked_wi}</span>` : ""}
										${isMyTask ? `<span class="wi-fp-yourtask">&#9658; YOUR TASK</span>` : ""}
									</div>
									<div class="wi-fp-card-name">${t.task_name || ""}</div>
									<div class="wi-fp-card-meta">${metaParts}</div>
								</div>
								<span class="wi-fp-badge ${isDoneStatus ? "wfb-done" : "wfb-active"}">${
							isDoneStatus ? "DONE" : "OPEN"
						}</span>
							</div>`;
					}

					rows += `
						<div class="wi-fp-row">
							<div class="wi-fp-left">
								<div class="${circleClass}">${t.idx}</div>
								${!isLast ? `<div class="${lineClass}"></div>` : ""}
							</div>
							<div class="wi-fp-right${isLast ? " wfr-last" : ""}">${cardHtml}</div>
						</div>`;
				});

				const html = `
					<div class="wi-flow-panel">
						<div class="wi-flow-header">
							<span class="wi-flow-title">Work Items in this Flow</span>
							<span class="wi-flow-count">${tasks.length} steps</span>
						</div>
						<div class="wi-flow-body">${rows}</div>
					</div>`;

				if (frm.fields_dict.html_aseg && frm.fields_dict.html_aseg.$wrapper) {
					frm.fields_dict.html_aseg.$wrapper.html(html);
					frm.fields_dict.html_aseg.$wrapper
						.find(".wi-fp-clickable[data-work-item]")
						.on("click", function () {
							const name = $(this).data("work-item");
							if (name)
								window.open(
									frappe.utils.get_form_link("Work Item", name),
									"_blank"
								);
						});
				}
			}
		},
	});
}

function wi_flow_inject_styles() {
	if (document.getElementById("wi-flow-panel-style")) return;
	$("head").append(`<style id="wi-flow-panel-style">
	.wi-flow-panel { margin-top:15px; border:1px solid var(--border-color,#e2e8f0); border-radius:12px; overflow:hidden; background:var(--card-bg,#fff); }
	.wi-flow-header { padding:10px 18px; border-bottom:1px solid var(--border-color,#e2e8f0); background:var(--control-bg,#f8fafc); display:flex; justify-content:space-between; align-items:center; }
	.wi-flow-title  { font-size:12px; font-weight:700; color:var(--text-color,#0f172a); }
	.wi-flow-count  { font-size:11px; color:var(--text-muted,#64748b); padding:3px 10px; border:1px solid var(--border-color,#e2e8f0); border-radius:9999px; }
	.wi-flow-body   { padding:18px 18px 12px; }
	.wi-fp-row   { display:flex; align-items:stretch; }
	.wi-fp-left  { display:flex; flex-direction:column; align-items:center; width:52px; flex-shrink:0; }
	.wi-fp-right { flex:1; padding-bottom:12px; padding-left:6px; padding-top:2px; min-width:0; }
	.wfr-last    { padding-bottom:2px; }
	.wi-fp-circle { width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; flex-shrink:0; position:relative; z-index:1; }
	.wfc-done     { background:#22c55e; border:2px solid #22c55e; color:#fff; }
	.wfc-active   { background:#3b82f6; border:2px solid #3b82f6; color:#fff; box-shadow:0 0 0 4px rgba(59,130,246,0.18); }
	.wfc-upcoming { background:var(--card-bg,#fff); border:2px solid #cbd5e1; color:#94a3b8; }
	.wi-fp-line   { width:2px; flex:1; min-height:14px; margin:3px 0; }
	.wfl-done     { background:#22c55e; }
	.wfl-active   { background:#3b82f6; }
	.wfl-upcoming { background:repeating-linear-gradient(180deg,#cbd5e1 0,#cbd5e1 5px,transparent 5px,transparent 10px); }
	.wi-fp-ghost  { display:flex; align-items:center; gap:10px; padding:9px 14px; border:1.5px dashed #cbd5e1; border-radius:8px; background:var(--control-bg,#fafafa); }
	[data-theme="dark"] .wi-fp-ghost { border-color:var(--border-color,#4a5568); }
	.wi-fp-ghost-title { font-size:13px; font-weight:600; color:#94a3b8; flex-shrink:0; }
	.wi-fp-ghost-meta  { font-size:12px; color:#b0bec5; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
	.wi-fp-card  { display:flex; justify-content:space-between; align-items:flex-start; padding:12px 14px; border-radius:10px; gap:10px; }
	.wfc-card-done   { background:var(--card-bg,#fff); border:1px solid #bbf7d0; border-left:3px solid #22c55e; }
	[data-theme="dark"] .wfc-card-done { border-color:#166534; border-left-color:#22c55e; }
	.wfc-card-active { background:var(--card-bg,#fff); border:1px solid rgba(59,130,246,0.4); border-left:3px solid #3b82f6; box-shadow:0 2px 8px rgba(59,130,246,0.10); }
	.wi-fp-clickable { cursor:pointer; transition:box-shadow 0.12s,background 0.12s; }
	.wi-fp-clickable:hover { box-shadow:0 3px 10px rgba(34,197,94,0.15); }
	.wi-fp-card-main { flex:1; min-width:0; }
	.wi-fp-card-top  { display:flex; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap; }
	.wi-fp-wi-id     { font-family:monospace; font-size:11px; color:var(--text-muted,#64748b); background:var(--card-bg,#fff); padding:1px 6px; border-radius:4px; border:1px solid var(--border-color,#e2e8f0); white-space:nowrap; }
	.wi-fp-yourtask  { font-size:11px; font-weight:700; color:#3b82f6; letter-spacing:0.05em; white-space:nowrap; }
.wi-fp-card-name { font-size:13px; font-weight:700; color:var(--text-color,#0f172a); margin-bottom:3px; }
	.wi-fp-card-meta { font-size:12px; color:var(--text-muted,#64748b); }
	.wi-fp-badge  { font-size:10px; font-weight:700; letter-spacing:0.06em; padding:4px 11px; border-radius:9999px; flex-shrink:0; align-self:center; white-space:nowrap; }
	.wfb-done     { background:#22c55e; color:#fff; }
	.wfb-active   { background:#3b82f6; color:#fff; }
	.wfb-upcoming { background:var(--card-bg,#fff); color:#94a3b8; border:1.5px dashed #cbd5e1; }
	</style>`);
}

function empty_fields(frm, fields) {
	if (!fields) return;
	if (Array.isArray(fields)) {
		for (let field of fields) {
			frm.set_value(field, null);
		}
		return;
	}

	// support object/map of fieldnames
	for (let field in fields) {
		if (Object.prototype.hasOwnProperty.call(fields, field)) {
			frm.set_value(field, null);
		}
	}
}

// ── 1. Override time format at runtime (session only, never persisted to DB) ──
frappe.sys_defaults.time_format = "HH:mm";

// ── 2. Force reinitialize pickers for the specific fields ─────────────────────
const DATETIME_FIELDS = ["target_end_date", "start_date_time", "actual_end_date"];

function reinit_datetime_pickers(frm) {
	DATETIME_FIELDS.forEach((fieldname) => {
		const ctrl = frm.fields_dict[fieldname];
		if (!ctrl || !ctrl.$input) return;

		const current_val = frm.doc[fieldname];

		// Destroy existing picker and rebuild with updated time_format
		if (ctrl.picker) {
			ctrl.picker.destroy?.();
			ctrl.picker = null;
		}
		ctrl.input_area?.replaceChildren?.();
		ctrl.$input.remove?.();
		ctrl.$input = null;

		ctrl.make_input();

		if (current_val) {
			ctrl.set_input(current_val);
		}
	});
}

function _setup_compact_benefit_row(frm) {
	const $ctrl = $(frm.wrapper).find(".frappe-control[data-fieldname='benefit_of_work_done']");
	if (!$ctrl.length || $ctrl.data("wi-compact-done")) return;
	$ctrl.data("wi-compact-done", true);
	$ctrl.addClass("wi-compact-benefit-row");
	if (!$ctrl.find(".wi-pct-suffix").length) {
		$ctrl.find(".control-input").append('<span class="wi-pct-suffix">%</span>');
	}
}

function _inject_wi_score_styles() {
	if (document.getElementById("wi-score-badge-styles")) return;
	$("head").append(`<style id="wi-score-badge-styles">
		@keyframes wi-dot-pulse {
			0%, 100% { opacity: 1; transform: scale(1); }
			50% { opacity: 0.35; transform: scale(0.65); }
		}
		.wi-score-dot-pulse { animation: wi-dot-pulse 1.4s ease-in-out infinite; }
	</style>`);
}

function render_wi_score_badge(frm) {
	frm.page.wrapper.find(".wi-score-badge").remove();
	if (frm.is_new()) return;

	_inject_wi_score_styles();

	const score = frm.doc.score;
	const hasScore = score != null;
	const rounded = !hasScore ? "&mdash;" : score === 0 ? "0" : score.toFixed(2);
	const color = !hasScore
		? "#8d99a5"
		: score >= -10
		? "#28a745"
		: score >= -30
		? "#fd7e14"
		: "#dc3545";

	const badge = $(`
		<span class="wi-score-badge" title="${
			hasScore ? __("View score breakdown") : __("Click to calculate score")
		}" style="
			display: inline-flex;
			align-items: center;
			gap: 5px;
			background: ${color}18;
			color: ${color};
			border: 1px solid ${color}${hasScore ? "55" : "44"};
			${!hasScore ? "border-style: dashed;" : ""}
			padding: 2px 10px;
			border-radius: 12px;
			font-size: 11px;
			font-weight: 600;
			margin-left: 8px;
			margin-right: 8px;
			cursor: pointer;
			letter-spacing: 0.3px;
		">
			<span class="${!hasScore ? "wi-score-dot-pulse" : ""}" style="
				width: 6px; height: 6px;
				border-radius: 50%;
				background: ${color};
				display: inline-block;
				flex-shrink: 0;
			"></span>
			Gap: ${rounded}
		</span>
	`);

	frm.page.wrapper.find(".page-head .page-actions").prepend(badge);
	badge.on("click", () => show_wi_score_popup(frm));
}

function show_wi_score_popup(frm) {
	frappe.db
		.get_list("Work Item Score Summary", {
			filters: { work_item: frm.doc.name },
			fields: ["name"],
			order_by: "creation desc",
			limit: 1,
		})
		.then((r) => _render_wi_score_popup(frm, r?.[0]?.name || null, null));
}

function _refresh_score_in_popup(frm, dialog) {
	dialog.fields_dict.score_html.$wrapper.html(`
		<div style="padding:40px 0;text-align:center;color:var(--text-muted);font-size:13px;">
			${__("Recalculating score...")}
		</div>
	`);

	frappe.call({
		method: "taskstream.taskstream.doctype.work_item.score_engine.recalculate_score",
		args: { docname: frm.doc.name },
		callback: function (r) {
			if (r.exc) {
				dialog.fields_dict.score_html.$wrapper.html(`
					<div style="padding:24px 0 8px;text-align:center;">
						<div style="font-size:13px;color:var(--text-muted);margin-bottom:20px;">
							${__("Could not calculate score. Please try again.")}
						</div>
						<button class="btn btn-sm btn-default wi-calculate-score-btn">${__("Retry")}</button>
					</div>
				`);
				dialog.fields_dict.score_html.$wrapper
					.find(".wi-calculate-score-btn")
					.on("click", () => {
						_refresh_score_in_popup(frm, dialog);
					});
				return;
			}

			frappe.db
				.get_value("Work Item", frm.doc.name, ["score", "score_breakdown"])
				.then((result) => {
					const vals = result.message;
					frm.doc.score = vals.score;
					frm.doc.score_breakdown = vals.score_breakdown;

					render_wi_score_badge(frm);
					frappe.show_alert({ message: __("Score recalculated"), indicator: "green" });

					if (!vals.score_breakdown) {
						dialog.fields_dict.score_html.$wrapper.html(`
							<div style="padding:24px 0 8px;text-align:center;">
								<div style="font-size:13px;color:var(--text-muted);margin-bottom:20px;">
									${__("Score could not be calculated. Please try again later.")}
								</div>
								<button class="btn btn-sm btn-default wi-calculate-score-btn">${__("Retry")}</button>
							</div>
						`);
						dialog.fields_dict.score_html.$wrapper
							.find(".wi-calculate-score-btn")
							.on("click", () => {
								_refresh_score_in_popup(frm, dialog);
							});
						return;
					}

					frappe.db
						.get_list("Work Item Score Summary", {
							filters: { work_item: frm.doc.name },
							fields: ["name"],
							order_by: "creation desc",
							limit: 1,
						})
						.then((wiss_r) => {
							_render_wi_score_popup(frm, wiss_r?.[0]?.name || null, dialog);
						});
				});
		},
	});
}

function _render_wi_score_popup(frm, wiss_name, dialog) {
	const isDone = ["Done", "Cancelled", "Unsuccessful", "Closed"].includes(frm.doc.status);
	if (!frm.doc.score_breakdown) {
		const d = new frappe.ui.Dialog({
			title: isDone ? __("Gap Score") : __("Projected Gap Score"),
			fields: [{ fieldtype: "HTML", fieldname: "score_html" }],
		});
		const target_end_date = frm.doc.target_end_date;
		d.fields_dict.score_html.$wrapper.html(`
			<div style="min-width:360px;">
				<div style="display:flex;align-items:center;justify-content:space-between;
					padding-bottom:14px;margin-bottom:4px;border-bottom:1px solid var(--border-color);">
					<div style="display:flex;align-items:center;gap:8px;">
						<div style="font-size:32px;font-weight:700;color:#28a745;line-height:1;">0</div>
						${
							!isDone
								? `<span class="wi-popup-refresh" title="${__(
										"Refresh score"
								  )}" style="
							font-size:16px;color:var(--text-muted);cursor:pointer;line-height:1;margin-top:4px;
						">↻</span>`
								: ""
						}
					</div>
					${
						target_end_date
							? `<div style="font-size:11px;color:var(--text-muted);text-align:right;">
						Target End Date:<br>${frappe.datetime.str_to_user(target_end_date)}
					</div>`
							: ""
					}
				</div>
				${
					wiss_name
						? `
				<div style="display:flex;justify-content:flex-end;padding-top:12px;">
					<a href="#" onclick="frappe.set_route('Form', 'Work Item Score Summary', '${wiss_name}'); return false;" style="
						font-size:12px;font-weight:500;
						color:var(--text-color);
						text-decoration:none;
						background:var(--control-bg);
						border:1px solid var(--border-color);
						padding:5px 12px;border-radius:6px;
						white-space:nowrap;
					">Work Item Summary &rarr;</a>
				</div>`
						: ""
				}
			</div>
		`);
		if (!isDone) {
			d.fields_dict.score_html.$wrapper.find(".wi-popup-refresh").on("click", () => {
				_refresh_score_in_popup(frm, d);
			});
		}
		d.show();
		return;
	}

	const data = JSON.parse(frm.doc.score_breakdown);
	const c = data.components;
	const score = frm.doc.score;

	if (score === 0 && isDone) {
		const content = `
			<div style="padding:20px 0;text-align:center;font-size:13px;font-weight:600;color:#28a745;">
				${__("Your task is complete with no gap.")}
			</div>
		`;
		if (dialog) {
			dialog.set_title(__("Gap Score"));
			dialog.fields_dict.score_html.$wrapper.html(content);
		} else {
			const d = new frappe.ui.Dialog({
				title: __("Gap Score"),
				fields: [{ fieldtype: "HTML", fieldname: "score_html" }],
			});
			d.fields_dict.score_html.$wrapper.html(content);
			d.show();
		}
		return;
	}

	const scoreColor = score >= -10 ? "#28a745" : score >= -30 ? "#fd7e14" : "#dc3545";

	const totalMins = c.delay.delay_hours * 60;
	const delayDays = Math.floor(totalMins / 1440);
	const delayHours = Math.floor((totalMins % 1440) / 60);
	const delayMins = Math.round(totalMins % 60);
	let delayText;
	if (c.delay.is_on_time) {
		delayText = "Completed within target end date";
	} else if (delayDays > 0) {
		delayText = `${delayDays} day${delayDays !== 1 ? "s" : ""}${
			delayHours > 0 ? ` ${delayHours} hr${delayHours !== 1 ? "s" : ""}` : ""
		} past target end date`;
	} else if (delayHours > 0) {
		delayText = `${delayHours} hr${delayHours !== 1 ? "s" : ""}${
			delayMins > 0 ? ` ${delayMins} min` : ""
		} past target end date`;
	} else {
		delayText = `${delayMins} min past target end date`;
	}

	function row(label, penalty, maxImpact, detail) {
		if (penalty === 0) return "";
		const context = [maxImpact ? `Max Impact: ${maxImpact} pts` : "", detail || ""]
			.filter(Boolean)
			.join(" &nbsp;&middot;&nbsp; ");
		return `
			<div style="padding:12px 0;border-bottom:1px solid var(--border-color);">
				<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;">
					<span style="font-size:13px;font-weight:600;color:var(--text-color);">${label}</span>
					<span style="font-size:13px;color:var(--text-color);">&minus;${penalty.toFixed(2)} pts</span>
				</div>
				<div style="font-size:12px;color:var(--text-muted);">${context}</div>
			</div>
		`;
	}

	const html = `
		<div style="min-width:360px;">
			<div style="display:flex;align-items:center;justify-content:space-between;
				padding-bottom:14px;margin-bottom:4px;border-bottom:1px solid var(--border-color);">
				<div style="display:flex;align-items:center;gap:8px;">
					<div style="font-size:32px;font-weight:700;color:${scoreColor};line-height:1;">
						${score === 0 ? "0" : score.toFixed(2)}
					</div>
					${
						!isDone
							? `<span class="wi-popup-refresh" title="${__(
									"Refresh score"
							  )}" style="
						font-size:16px;
						color:var(--text-muted);
						cursor:pointer;
						line-height:1;
						margin-top:4px;
					">↻</span>`
							: ""
					}
				</div>
				${
					c.delay.target_end_date
						? `
				<div style="font-size:11px;color:var(--text-muted);text-align:right;">
					Target End Date:<br>${frappe.datetime.str_to_user(c.delay.target_end_date)}
				</div>`
						: ""
				}
			</div>
			${row("Delay", c.delay.penalty, c.delay.max, c.delay.is_on_time ? "" : delayText)}
			${
				wiss_name
					? `
			<div style="display:flex;justify-content:flex-end;padding-top:12px;">
				<a href="#" onclick="frappe.set_route('Form', 'Work Item Score Summary', '${wiss_name}'); return false;" style="
					font-size:12px;font-weight:500;
					color:var(--text-color);
					text-decoration:none;
					background:var(--control-bg);
					border:1px solid var(--border-color);
					padding:5px 12px;border-radius:6px;
					white-space:nowrap;
				">Work Item Summary &rarr;</a>
			</div>`
					: ""
			}
		</div>
	`;

	const isNew = !dialog;
	if (isNew) {
		dialog = new frappe.ui.Dialog({
			title: isDone ? __("Gap Score") : __("Projected Gap Score"),
			fields: [{ fieldtype: "HTML", fieldname: "score_html" }],
		});
	} else {
		dialog.set_title(isDone ? __("Gap Score") : __("Projected Gap Score"));
	}

	dialog.fields_dict.score_html.$wrapper.html(html);

	if (!isDone) {
		dialog.fields_dict.score_html.$wrapper.find(".wi-popup-refresh").on("click", () => {
			_refresh_score_in_popup(frm, dialog);
		});
	}

	if (isNew) dialog.show();
}
