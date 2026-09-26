// Regenerates the README / social images from the running dev server:
//
//   docs/theme-phosphor.png, docs/theme-paper.png - each theme at 2044x1170,
//     light mode on the left, dark on the right, split diagonally.
//   docs/social-preview.png - 1280x640, scripts/social-preview.html with one
//     diagonally split group card per theme.
//
// macOS only (WebKit + Core Graphics, no dependencies). With `npm run dev`
// running:  npm run screenshots   (or: swift scripts/screenshots.swift [url])
//
// Every page load uses a fresh, non-persistent data store, so the shots show the
// first-run demo config regardless of what your own browser has stored.
import AppKit
import WebKit

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let appURL = URL(string: CommandLine.arguments.dropFirst().first ?? "http://localhost:5173")!
let docs = root.appendingPathComponent("docs")

let VIEW = CGSize(width: 1022, height: 585)   // CSS viewport of the app shots
let SHOT = CGSize(width: 2044, height: 1170)  // output pixels (2x)
let SOCIAL = CGSize(width: 1280, height: 640)
let TILE_GROUP = "Hosting"                    // group card used for the social tiles
let TILE_MARGIN: CGFloat = 20                 // page visible around it, CSS px
// Diagonal split: from 58% across the top edge to 42% across the bottom.
let SPLIT_TOP: CGFloat = 0.58, SPLIT_BOTTOM: CGFloat = 0.42

// Healthy "Home" demo state: every health dot up, pill on Home. Re-applied on
// a timer because the app's own probes keep resetting it. Transitions are off
// because off-screen WebKit never advances them - the dots would stay grey.
let staging = """
const stage = () => {
  document.querySelectorAll('.entry-status').forEach(e => { e.classList.remove('checking', 'down'); e.classList.add('up'); });
  document.getElementById('location-pill').classList.remove('checking', 'away', 'locked');
  document.getElementById('location-text').textContent = 'Home';
};
const st = document.createElement('style');
st.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
document.head.appendChild(st);
stage(); setInterval(stage, 30);
"""
let tileRectJS = """
(() => {
  const g = [...document.querySelectorAll('.group')]
    .find(g => g.querySelector('.group-title')?.textContent.trim() === '\(TILE_GROUP)');
  const r = g.getBoundingClientRect();
  return [r.x, r.y, r.width, r.height];
})()
"""

func fail(_ msg: String) -> Never { FileHandle.standardError.write((msg + "\n").data(using: .utf8)!); exit(1) }

func makeContext(_ size: CGSize) -> CGContext {
  CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8,
            bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
}

/// Redraws `img` at exactly `size` (snapshots come out at the screen's scale).
func resized(_ img: CGImage, _ size: CGSize) -> CGImage {
  if img.width == Int(size.width) && img.height == Int(size.height) { return img }
  let ctx = makeContext(size)
  ctx.interpolationQuality = .high
  ctx.draw(img, in: CGRect(origin: .zero, size: size))
  return ctx.makeImage()!
}

/// `light` with `dark` laid over the right-hand side of the diagonal.
func split(_ light: CGImage, _ dark: CGImage) -> CGImage {
  let size = CGSize(width: light.width, height: light.height)
  let ctx = makeContext(size)
  let rect = CGRect(origin: .zero, size: size)
  ctx.draw(light, in: rect)
  let path = CGMutablePath() // CG origin is bottom-left: y = height is the top edge
  path.move(to: CGPoint(x: size.width * SPLIT_TOP, y: size.height))
  path.addLine(to: CGPoint(x: size.width, y: size.height))
  path.addLine(to: CGPoint(x: size.width, y: 0))
  path.addLine(to: CGPoint(x: size.width * SPLIT_BOTTOM, y: 0))
  path.closeSubpath()
  ctx.addPath(path); ctx.clip(); ctx.draw(dark, in: rect)
  return ctx.makeImage()!
}

func png(_ img: CGImage) -> Data {
  NSBitmapImageRep(cgImage: img).representation(using: .png, properties: [:])!
}

func write(_ img: CGImage, _ name: String) {
  do { try png(img).write(to: docs.appendingPathComponent(name)) } catch { fail("write \(name): \(error)") }
  print("wrote docs/\(name) (\(img.width)x\(img.height))")
}

final class Shooter: NSObject, WKNavigationDelegate {
  struct Shot { let image: CGImage; let tile: CGRect }  // tile in CSS px
  var jobs: [(palette: String, dark: Bool)] =
    [("phosphor", false), ("phosphor", true), ("paper", false), ("paper", true)]
  var shots: [String: Shot] = [:]
  var web: WKWebView!
  var onLoad: ((WKWebView) -> Void)?
  let window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 10, height: 10),
                        styleMask: .borderless, backing: .buffered, defer: false)

  func newWebView(_ size: CGSize, seed: String?) -> WKWebView {
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .nonPersistent()
    if let seed = seed {
      cfg.userContentController.addUserScript(
        WKUserScript(source: seed, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    window.setContentSize(size)
    let web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: cfg)
    web.navigationDelegate = self
    window.contentView = web
    window.orderFront(nil)
    self.web = web
    return web
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { onLoad?(webView) }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    fail("could not load \(webView.url?.absoluteString ?? "page"): \(error.localizedDescription)\n" +
         "Is the dev server running? (npm run dev)")
  }

  /// Snapshot of the whole view, normalised to exactly `pixels`.
  func snapshot(_ web: WKWebView, _ pixels: CGSize, _ done: @escaping (CGImage) -> Void) {
    let sc = WKSnapshotConfiguration()
    sc.snapshotWidth = NSNumber(value: Double(pixels.width / window.backingScaleFactor))
    web.takeSnapshot(with: sc) { img, err in
      guard let img = img else { fail("snapshot failed: \(String(describing: err))") }
      var r = NSRect(origin: .zero, size: pixels)
      done(resized(img.cgImage(forProposedRect: &r, context: nil, hints: nil)!, pixels))
    }
  }

  func nextShot() {
    guard let job = jobs.first else { composeAll(); return }
    let seed = "localStorage.setItem('crtl-theme', '\(job.dark ? "dark" : "light")');" +
               "localStorage.setItem('crtl-palette', '\(job.palette)');"
    let web = newWebView(VIEW, seed: seed)
    onLoad = { web in
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
        web.evaluateJavaScript(staging) { _, _ in
          web.evaluateJavaScript(tileRectJS) { rect, err in
            guard let r = rect as? [Double], r.count == 4 else { fail("no '\(TILE_GROUP)' group: \(String(describing: err))") }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
              self.snapshot(web, SHOT) { img in
                let job = self.jobs.removeFirst()
                self.shots["\(job.palette)-\(job.dark ? "dark" : "light")"] =
                  Shot(image: img, tile: CGRect(x: r[0], y: r[1], width: r[2], height: r[3]))
                self.nextShot()
              }
            }
          }
        }
      }
    }
    web.load(URLRequest(url: appURL))
  }

  /// The tile group plus a margin of page, cut from a shot.
  func crop(_ shot: Shot) -> CGImage {
    let k = CGFloat(shot.image.width) / VIEW.width
    let r = shot.tile.insetBy(dx: -TILE_MARGIN, dy: -TILE_MARGIN)
    return shot.image.cropping(to: CGRect(x: r.minX * k, y: r.minY * k, width: r.width * k, height: r.height * k).integral)!
  }

  func composeAll() {
    var tiles: [String: String] = [:]
    for p in ["phosphor", "paper"] {
      guard let l = shots["\(p)-light"], let d = shots["\(p)-dark"] else { fail("missing \(p) shots") }
      write(split(l.image, d.image), "theme-\(p).png")
      tiles[p] = "data:image/png;base64," + png(split(crop(l), crop(d))).base64EncodedString()
    }
    let template = root.appendingPathComponent("scripts/social-preview.html")
    let web = newWebView(SOCIAL, seed: nil)
    onLoad = { web in
      web.callAsyncJavaScript("return await setTiles(a, b)",
                              arguments: ["a": tiles["phosphor"]!, "b": tiles["paper"]!],
                              in: nil, in: .page) { result in
        if case .failure(let e) = result { fail("social template: \(e)") }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
          self.snapshot(web, SOCIAL) { img in write(img, "social-preview.png"); exit(0) }
        }
      }
    }
    web.loadFileURL(template, allowingReadAccessTo: root)
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let shooter = Shooter()
DispatchQueue.main.async { shooter.nextShot() }
app.run()
