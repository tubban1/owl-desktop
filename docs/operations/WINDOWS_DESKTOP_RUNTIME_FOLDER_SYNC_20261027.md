# Windows OWL Desktop user-authorized filesystem — 2026-10-27

## Proven issue
The Windows development Desktop persisted the user's explicit folders including `C:\\`, but its managed Runtime had hard-coded `mcp-workspace` as the sole filesystem root. Separate DEV flags forced Shell, Write, Delete, Git Push and Rollback off even when Settings stored `enabled`.

## Contract and solution
Desktop **user-selected root directories are actual authorizations**. The Runtime includes them, including entire volumes, subject to the Windows OS access control and actual file existence. The application must not silently introduce a blanket root, profile or system-directory ban that contradicts the user's express approval. Invalid paths or inaccessible paths yield a clear error.

On each managed Windows DEV Runtime startup:
- Read saved `allowedDirectories` and canonicalize/deduplicate roots (including `C:\\`).
- Apply `runtimePermissionModes` using the **same shared** `applyRuntimePermissionModes` logic used for packaged Runtime. On/Off must be honored. Ask depends on Runtime signed-approval support.
- Use `powershell.exe` for the Windows Shell provider, which invokes commands with `-c`.
- Windows Desktop Settings displays both saved roots and the live Runtime filesystem roots and Write/Delete effective switches. Updating folders restarts only the owned development Runtime.

## Windows live acceptance evidence
After updated Windows Desktop and managed Runtime restarted:
- Live filesystem provider listed `mcp-workspace`, Desktop, Documents, Downloads, **and `C:\\`**.
- Provider reported Write=true, Delete=true; Shell enabled, Git Push=true and Rollback=true.
- `list_directory('C:\\\\')` succeeded; `file_info('C:\\\\Windows')` succeeded.
- Created test file in Downloads, read exact contents, then deleted it; **all successful**.
- `execute_command` running a PowerShell echo returned exitCode 0.
- The live Desktop persists the user's 4 folders; no user files were modified during acceptance except the short-lived test file.

## Scope
An enabled feature remains bounded by the Windows operating-system rights of the user's account. A Runtime grant does not make arbitrary operations safe or make another connector share these permissions. Do not confuse a saved Desktop permission with a proven live Runtime capability. Never describe a permission as active without reading the live provider and running an appropriately scoped check.

The original 2026-10-27 conservative Windows DEV restrictions were superseded by the user's explicit authorization and replaced as part of this repair.
