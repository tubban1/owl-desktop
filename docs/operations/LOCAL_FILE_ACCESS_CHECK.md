# Local File Access and Documents

OWL Runtime authorizes the actual filesystem roots. read_document converts PDF, DOCX, XLSX and PPTX into bounded text locally, after Runtime fs.stat and canonical path/mtime/size checks. No external upload occurs.

Maximum source: 15 MiB. Maximum output: 100,000 characters. PDF page limit: 35, Office XML limit: 28 MiB. Scanned PDF pages return SCANNED_PDF_REQUIRES_OCR instead of claiming text was extracted.

macOS EPERM from Library/Mail or other TCC-protected storage requires manual OS privacy permission to the actual running app (OWL Desktop or Runtime). OWL directory authorization cannot and must not bypass system privacy controls. Restart the permitted process after granting access.

OWL Mail uses separately authorized native IMAP/SMTP credentials with user-approved send. The ChatGPT Gmail plugin cannot open local Mac paths. OWL send_file returns a private, expiring HTTPS link but not a registered ChatGPT attachment. Never claim an email sent until the provider confirms it.
