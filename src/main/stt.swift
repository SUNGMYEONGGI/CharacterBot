// On-device speech-to-text for voice memos (Speech framework, macOS 26+).
// Usage: stt <audio file> [locale]. Prints the transcript.

import Foundation
import Speech
import AVFoundation

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let locale = Locale(identifier: CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "ko-KR")
let sem = DispatchSemaphore(value: 0)
Task {
  do {
    guard let loc = await SpeechTranscriber.supportedLocale(equivalentTo: locale) else { print("ERR unsupported locale"); exit(2) }
    let transcriber = SpeechTranscriber(locale: loc, preset: .transcription)
    if let req = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) { try await req.downloadAndInstall() }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let file = try AVAudioFile(forReading: url)
    async let text = transcriber.results.reduce("") { $0 + String($1.text.characters) }
    if let last = try await analyzer.analyzeSequence(from: file) { try await analyzer.finalizeAndFinish(through: last) } else { await analyzer.cancelAndFinishNow() }
    print(try await text)
  } catch { print("ERR \(error)"); exit(1) }
  sem.signal()
}
sem.wait()
