// The standard antivirus test string (https://www.eicar.org/download-anti-malware-testfile/),
// not a real virus: every antivirus engine recognises this exact byte
// sequence by design, precisely so integrations like this one can be
// tested without a real malicious payload. PRD.md Phase 7's own acceptance
// criterion is stated in terms of it: "An EICAR test file is quarantined
// and permanently undownloadable."
//
// This is the whole scanning engine for now. docs/PRD.md §16.1 names the
// real one ("SQS -> Lambda: virus scan (ClamAV layer)"), which needs a
// Lambda layer and a signature database this monorepo does not build or
// deploy; that is separate, later infrastructure work. Detecting this one
// signature is a real, correct implementation of the one Phase 7 has an
// acceptance test for, not a placeholder standing in for it.
const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export type ScanOutcome = 'clean' | 'infected';

// latin1 rather than utf8: the signature is pure ASCII, and a binary file
// containing invalid UTF-8 sequences must not throw or silently drop bytes
// partway through the search. latin1 maps every byte to one code point,
// so the search sees the whole buffer exactly as it exists on disk.
export function scanBytes(bytes: Buffer): ScanOutcome {
  return bytes.toString('latin1').includes(EICAR_SIGNATURE) ? 'infected' : 'clean';
}
