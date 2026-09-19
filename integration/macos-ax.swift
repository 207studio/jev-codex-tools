import AppKit
import ApplicationServices
import CryptoKit

// Read-only permission probe. Never invoke AXIsProcessTrustedWithOptions or activate apps.
func emit(_ data: [String: Any]) {
    if let bytes = try? JSONSerialization.data(withJSONObject: data, options: [.sortedKeys]),
       let line = String(data: bytes, encoding: .utf8) { print(line); fflush(stdout) }
}
func attr(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
    return value
}
func str(_ element: AXUIElement, _ key: String) -> String { attr(element, key) as? String ?? "" }
func flag(_ element: AXUIElement, _ key: String) -> Bool { (attr(element, key) as? NSNumber)?.boolValue ?? false }
func children(_ element: AXUIElement) -> [AXUIElement] { attr(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func digest(_ value: Any) -> String {
    guard let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return "" }
    return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
}
func geom(_ element: AXUIElement) -> [Double] {
    var point = CGPoint.zero, size = CGSize.zero
    if let raw = attr(element, kAXPositionAttribute), CFGetTypeID(raw) == AXValueGetTypeID() {
        _ = AXValueGetValue(unsafeBitCast(raw, to: AXValue.self), .cgPoint, &point)
    }
    if let raw = attr(element, kAXSizeAttribute), CFGetTypeID(raw) == AXValueGetTypeID() {
        _ = AXValueGetValue(unsafeBitCast(raw, to: AXValue.self), .cgSize, &size)
    }
    return [point.x, point.y, size.width, size.height].map(Double.init)
}
func label(_ element: AXUIElement) -> String {
    let title = str(element, kAXTitleAttribute)
    return title.isEmpty ? str(element, kAXDescriptionAttribute) : title
}
let forbidden = try! NSRegularExpression(pattern: "delete|remove|purchase|buy|sell|pay|send|publish|submit|sign|accept|confirm|save|install|uninstall|grant|allow|password|permission|erase|trash|close|quit|reset|discard|삭제|제거|구매|결제|송금|전송|게시|발행|제출|동의|확인|저장|설치|허용|비밀번호|권한|초기화|닫기|종료|버리", options: [.caseInsensitive])
func blocked(_ text: String) -> Bool { forbidden.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil }
func windowSignature(_ window: AXUIElement, _ pid: pid_t, _ bundle: String) -> String {
    digest(["pid": Int(pid), "bundle": bundle,
        "title": str(window, kAXTitleAttribute), "identifier": str(window, kAXIdentifierAttribute),
        "role": str(window, kAXRoleAttribute), "subrole": str(window, kAXSubroleAttribute), "geometry": geom(window),
        "childCount": children(window).count])
}
func elementSignature(_ element: AXUIElement, _ windowFingerprint: String, _ path: [Int], _ parentRole: String, _ parentText: String) -> String {
    let value = attr(element, kAXValueAttribute)
    return digest(["window": windowFingerprint, "path": path, "role": str(element, kAXRoleAttribute), "text": label(element),
        "identifier": str(element, kAXIdentifierAttribute), "description": str(element, kAXDescriptionAttribute),
        "geometry": geom(element), "parentRole": parentRole, "parentText": parentText,
        "value": value as? String ?? (value as? NSNumber)?.stringValue ?? "", "selected": flag(element, kAXSelectedAttribute)])
}
struct Candidate {
    let id: String
    let element: AXUIElement
    let path: [Int]
    let fingerprint: String
    let data: [String: Any]
}
struct Snapshot {
    let pid: pid_t
    let bundle: String
    let window: AXUIElement
    let windowFingerprint: String
    let candidates: [Candidate]
}
var cached: Snapshot?

func observe(_ request: [String: Any]) -> (Snapshot?, String) {
    guard let bundle = request["app"] as? String, let names = request["names"] as? [String],
          !bundle.isEmpty, names.count > 0, names.count <= 40,
          names.allSatisfy({ !$0.isEmpty && $0.count <= 180 && !blocked($0) }) else { return (nil, "invalid_allowlist") }
    guard let app = NSWorkspace.shared.frontmostApplication, app.bundleIdentifier == bundle else { return (nil, "app_not_frontmost") }
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(axApp, 1.0)
    guard let rawWindow = attr(axApp, kAXFocusedWindowAttribute), CFGetTypeID(rawWindow) == AXUIElementGetTypeID() else { return (nil, "focused_window_unavailable") }
    let window = unsafeBitCast(rawWindow, to: AXUIElement.self)
    guard !flag(window, kAXModalAttribute), str(window, kAXSubroleAttribute) != "AXDialog" else { return (nil, "modal_window") }
    let windowFingerprint = windowSignature(window, app.processIdentifier, bundle)
    var candidates: [Candidate] = [], visited = 0, modal = false, truncated = false
    func walk(_ element: AXUIElement, _ path: [Int], _ parentRole: String, _ parentText: String) {
        if visited >= 1600 || path.count > 28 { truncated = true; return }
        visited += 1
        let role = str(element, kAXRoleAttribute), text = label(element)
        if role == "AXSheet" || role == "AXDialog" || str(element, kAXSubroleAttribute) == "AXDialog" || flag(element, kAXModalAttribute) { modal = true; return }
        var actions: CFArray?
        if (role == "AXButton" || role == "AXRadioButton"), names.contains(text), flag(element, kAXEnabledAttribute), !blocked(parentText),
           AXUIElementCopyActionNames(element, &actions) == .success, (actions as? [String] ?? []).contains(kAXPressAction) {
            let id = "e" + path.map(String.init).joined(separator: "_")
            let fingerprint = elementSignature(element, windowFingerprint, path, parentRole, parentText)
            candidates.append(Candidate(id: id, element: element, path: path, fingerprint: fingerprint, data: [
                "id": id, "role": role, "text": text, "fingerprint": fingerprint,
                "parent": ["role": parentRole, "text": String(parentText.prefix(120))]]))
        }
        for (index, child) in children(element).enumerated() { walk(child, path + [index], role, text) }
    }
    walk(window, [], "", "")
    guard !modal else { return (nil, "modal_window") }
    guard !truncated else { return (nil, "tree_limit") }
    guard candidates.count <= 40 else { return (nil, "candidate_limit") }
    // Duplicate labels are ambiguous; the selector must never guess between them.
    candidates = candidates.filter { candidate in candidates.filter { $0.data["text"] as? String == candidate.data["text"] as? String }.count == 1 }
    return (Snapshot(pid: app.processIdentifier, bundle: bundle, window: window, windowFingerprint: windowFingerprint, candidates: candidates), "observed")
}
func output(_ snapshot: Snapshot) -> [String: Any] {
    ["status": "observed", "app": snapshot.bundle, "pid": Int(snapshot.pid), "window_fingerprint": snapshot.windowFingerprint,
     "elements": snapshot.candidates.map(\.data)]
}
while let line = readLine() {
    guard line.utf8.count <= 16384,
          let bytes = line.data(using: .utf8), let request = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] else { emit(["status": "invalid_request"]); continue }
    let trusted = AXIsProcessTrusted()
    if request["action"] as? String == "status" { emit(["status": "permission_status", "trusted": trusted]); continue }
    guard trusted else { emit(["status": "accessibility_permission_required", "trusted": false]); continue }
    guard let action = request["action"] as? String, action == "observe" || action == "press" else { emit(["status": "invalid_request"]); continue }
    let previous = cached
    let (fresh, reason) = observe(request)
    guard let fresh = fresh else { cached = nil; emit(["status": reason]); continue }
    if action == "observe" { cached = fresh; emit(output(fresh)); continue }
    guard let previous = previous,
          let id = request["id"] as? String, let fingerprint = request["fingerprint"] as? String,
          request["window_fingerprint"] as? String == previous.windowFingerprint,
          previous.bundle == fresh.bundle, previous.pid == fresh.pid,
          previous.windowFingerprint == fresh.windowFingerprint, CFEqual(previous.window, fresh.window),
          let before = previous.candidates.first(where: { $0.id == id && $0.fingerprint == fingerprint }),
          let current = fresh.candidates.first(where: { $0.id == id && $0.fingerprint == fingerprint }),
          CFEqual(before.element, current.element),
          NSWorkspace.shared.frontmostApplication?.processIdentifier == fresh.pid else {
        cached = nil; emit(["status": "state_changed"]); continue
    }
    // Re-read the selected element after traversal and immediately before the only mutation.
    let finalApp = AXUIElementCreateApplication(fresh.pid)
    guard let finalRawWindow = attr(finalApp, kAXFocusedWindowAttribute), CFGetTypeID(finalRawWindow) == AXUIElementGetTypeID(),
          let parentRaw = attr(current.element, kAXParentAttribute), CFGetTypeID(parentRaw) == AXUIElementGetTypeID() else {
        cached = nil; emit(["status": "state_changed"]); continue
    }
    let finalWindow = unsafeBitCast(finalRawWindow, to: AXUIElement.self)
    let finalParent = unsafeBitCast(parentRaw, to: AXUIElement.self)
    guard CFEqual(finalWindow, fresh.window), windowSignature(finalWindow, fresh.pid, fresh.bundle) == fresh.windowFingerprint,
          !flag(finalWindow, kAXModalAttribute), flag(current.element, kAXEnabledAttribute),
          elementSignature(current.element, fresh.windowFingerprint, current.path, str(finalParent, kAXRoleAttribute), label(finalParent)) == fingerprint,
          NSWorkspace.shared.frontmostApplication?.processIdentifier == fresh.pid else {
        cached = nil; emit(["status": "state_changed"]); continue
    }
    let result = AXUIElementPerformAction(current.element, kAXPressAction as CFString)
    cached = nil
    emit(["status": result == .success ? "pressed" : "press_failed", "error_code": result.rawValue])
}
