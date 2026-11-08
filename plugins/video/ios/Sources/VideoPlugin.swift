import AVFoundation
import ObjectiveC
import Tauri
import UIKit
import WebKit

final class VideoLayer: CAMetalLayer {
    override var drawableSize: CGSize {
        get { super.drawableSize }
        set {
            if Int(newValue.width) > 1 && Int(newValue.height) > 1 {
                super.drawableSize = newValue
            }
        }
    }
}

final class VideoView: UIView {
    override class var layerClass: AnyClass { VideoLayer.self }
}

enum Orientation {
    static var mask: UIInterfaceOrientationMask = .portrait
    private static var patched = Set<ObjectIdentifier>()

    static func install(from view: UIView) {
        var controllers: [UIViewController] = []
        var responder: UIResponder? = view
        while let r = responder {
            if let vc = r as? UIViewController {
                controllers.append(vc)
                break
            }
            responder = r.next
        }
        if let root = view.window?.rootViewController {
            controllers.append(root)
        }
        for vc in controllers {
            patch(type(of: vc))
        }
    }

    private static func patch(_ cls: AnyClass) {
        let id = ObjectIdentifier(cls)
        if patched.contains(id) {
            return
        }
        patched.insert(id)
        let sel = #selector(getter: UIViewController.supportedInterfaceOrientations)
        let block: @convention(block) (AnyObject) -> UInt = { _ in Orientation.mask.rawValue }
        let imp = imp_implementationWithBlock(block)
        if !class_addMethod(cls, sel, imp, "Q@:"), let method = class_getInstanceMethod(cls, sel) {
            method_setImplementation(method, imp)
        }
    }

    static func apply(_ next: UIInterfaceOrientationMask) {
        mask = next
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if #available(iOS 16.0, *) {
            for scene in scenes {
                for window in scene.windows {
                    window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
                }
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: next)) { _ in }
            }
        } else {
            let target: UIInterfaceOrientation = next == .portrait ? .portrait : .landscapeRight
            UIDevice.current.setValue(target.rawValue, forKey: "orientation")
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }
}

struct AwakeArgs: Decodable {
    let on: Bool
}

struct OpenArgs: Decodable {
    let url: String
}

final class VideoPlugin: Plugin {
    private let video = VideoView(frame: .zero)
    private var pointer = 0

    override func load(webview: WKWebView) {
        webview.isOpaque = false
        webview.backgroundColor = .clear
        webview.scrollView.backgroundColor = .clear
        video.backgroundColor = .black
        video.isUserInteractionEnabled = false
        video.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        if let layer = video.layer as? CAMetalLayer {
            layer.contentsScale = UIScreen.main.nativeScale
            layer.framebufferOnly = true
            layer.backgroundColor = UIColor.black.cgColor
        }
        pointer = Int(bitPattern: Unmanaged.passUnretained(video.layer).toOpaque())
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        place(webview, tries: 0)
    }

    private func place(_ webview: WKWebView, tries: Int) {
        guard let host = webview.superview else {
            if tries < 50 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.place(webview, tries: tries + 1) }
            }
            return
        }
        video.frame = host.bounds
        host.insertSubview(video, belowSubview: webview)
        Orientation.install(from: host)
        Orientation.apply(Orientation.mask)
    }

    @objc public func layer(_ invoke: Invoke) {
        invoke.resolve(["pointer": pointer])
    }

    @objc public func awake(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AwakeArgs.self)
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = args.on
            invoke.resolve()
        }
    }

    @objc public func landscape(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AwakeArgs.self)
        DispatchQueue.main.async {
            Orientation.apply(args.on ? .landscape : .portrait)
            invoke.resolve()
        }
    }

    @objc public func open(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(OpenArgs.self)
        guard let url = URL(string: args.url) else {
            invoke.reject("Liên kết không hợp lệ")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url)
            invoke.resolve()
        }
    }
}

@_cdecl("init_plugin_wistv_video")
func initPlugin() -> Plugin {
    return VideoPlugin()
}
