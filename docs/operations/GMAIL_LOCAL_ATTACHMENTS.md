# OWL Mail: native Gmail local attachments

## Root cause

The Gmail plugin in ChatGPT operates in a cloud file environment and cannot dereference a user's macOS local path (such as /Users/<user>/Downloads/sd/file.pdf). Gmail accepts a registered ChatGPT sandbox file, but OWL MCP's file-delivery links alone are not that registration. This is a cross-environment boundary, not a read-file permission bug.

## Native fix

OWL Mail now accepts the Gmail provider at Settings > Mail accounts. Google app passwords (when enabled by Google) are entered locally and stored in Desktop's OS-backed encrypted vault. This is a **separate account connection** from the first-party ChatGPT Gmail plugin; Gmail OAuth tokens cannot be transferred or reused between these integrations.

Use mail_create_draft with attachment_paths listing fully qualified local files under the current OS user's Downloads directory. This stores only SHA-256 fingerprints, file metadata and original paths in the encrypted local draft; it does not upload the PDFs, write them to S3 or copy them into ChatGPT.

Limits: 10 attachments, 15 MiB aggregate, approved standard document/image extensions, no symlinks, dotfiles or protected credential locations. Before sending, mail_send_draft displays native OS approval with attachment names and sizes. It re-reads and verifies each file; modified files abort before any SMTP call. Nodemailer accepts in-memory Buffer attachments only; filesystem and URL reads inside Nodemailer are disabled.

Gmail drafts created via OWL Mail are local encrypted drafts, not copies in Gmail's web Drafts folder. Sending uses TLS SMTP from the local machine, and a native confirmation is mandatory. Network-uncertain sends are never auto-retried.

## Testing

Run: npm test -- tests/owl-mail.test.mjs tests/owl-gmail-attachments.test.mjs

This covers Gmail endpoint validation, local PDF fidelity, approval details, tamper detection, directory containment, symlinks, and SMTP no-file-access enforcement. Live Gmail submission requires the user to configure a valid app password locally and approve sending; mock tests do not imply a real mailbox has been authenticated.
