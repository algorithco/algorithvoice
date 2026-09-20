import Foundation

/// Dependency-free SHA-256 (FIPS 180-4), streaming-capable.
///
/// Rationale: `CryptoKit` is Apple-only, but this module must stay portable
/// (CI also exercises Core on Linux runners, and the algorithm must be
/// testable against NIST vectors anywhere). The hasher is used by the PR4
/// downloader to verify every model file against its manifest `sha256`
/// before the atomic rename — same fail-closed role as
/// `verify_file()` in `local_asr/downloader.rs`.
public struct SHA256Hasher: Sendable {
    private var h: [UInt32] = [
        0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
        0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
    ]
    private var buffer = Data()
    private var totalLength: UInt64 = 0

    private static let k: [UInt32] = [
        0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
        0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
        0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
        0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
        0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
        0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
        0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
        0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
    ]

    public init() {}

    public mutating func update(_ data: Data) {
        totalLength += UInt64(data.count)
        appendRaw(data)
    }

    public func finalized() -> Data {
        var copy = self
        // Merkle–Damgård padding: 0x80, zeros, then 64-bit big-endian bit length.
        let lengthModulo = (copy.totalLength + 1) % 64
        let zeroCount = lengthModulo <= 56 ? 56 - lengthModulo : 120 - lengthModulo
        var padding = Data([0x80])
        padding.append(Data(repeating: 0, count: Int(zeroCount)))
        var bitLength = (copy.totalLength * 8).bigEndian
        withUnsafeBytes(of: &bitLength) { padding.append(contentsOf: $0) }
        copy.appendRaw(padding)
        precondition(copy.buffer.isEmpty, "padding must complete the final block")
        var digest = Data(capacity: 32)
        for word in copy.h {
            var bigEndian = word.bigEndian
            withUnsafeBytes(of: &bigEndian) { digest.append(contentsOf: $0) }
        }
        return digest
    }

    // MARK: - Internals

    private mutating func appendRaw(_ data: Data) {
        buffer.append(data)
        while buffer.count >= 64 {
            processBlock(buffer.prefix(64))
            buffer.removeFirst(64)
        }
    }

    private static func rotateRight(_ value: UInt32, _ amount: UInt32) -> UInt32 {
        (value >> amount) | (value << (32 - amount))
    }

    private mutating func processBlock(_ block: Data) {
        precondition(block.count == 64)
        let bytes = [UInt8](block)
        var schedule = [UInt32](repeating: 0, count: 64)
        for index in 0..<16 {
            let base = index * 4
            schedule[index] = UInt32(bytes[base]) << 24
                | UInt32(bytes[base + 1]) << 16
                | UInt32(bytes[base + 2]) << 8
                | UInt32(bytes[base + 3])
        }
        for index in 16..<64 {
            let s0 = Self.rotateRight(schedule[index - 15], 7)
                ^ Self.rotateRight(schedule[index - 15], 18)
                ^ (schedule[index - 15] >> 3)
            let s1 = Self.rotateRight(schedule[index - 2], 17)
                ^ Self.rotateRight(schedule[index - 2], 19)
                ^ (schedule[index - 2] >> 10)
            schedule[index] = schedule[index - 16] &+ s0 &+ schedule[index - 7] &+ s1
        }
        var (a, b, c, d, e, f, g, hh) = (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7])
        for index in 0..<64 {
            let bigSigma1 = Self.rotateRight(e, 6) ^ Self.rotateRight(e, 11) ^ Self.rotateRight(e, 25)
            let choice = (e & f) ^ (~e & g)
            let temp1 = hh &+ bigSigma1 &+ choice &+ Self.k[index] &+ schedule[index]
            let bigSigma0 = Self.rotateRight(a, 2) ^ Self.rotateRight(a, 13) ^ Self.rotateRight(a, 22)
            let majority = (a & b) ^ (a & c) ^ (b & c)
            let temp2 = bigSigma0 &+ majority
            hh = g
            g = f
            f = e
            e = d &+ temp1
            d = c
            c = b
            b = a
            a = temp1 &+ temp2
        }
        h[0] = h[0] &+ a
        h[1] = h[1] &+ b
        h[2] = h[2] &+ c
        h[3] = h[3] &+ d
        h[4] = h[4] &+ e
        h[5] = h[5] &+ f
        h[6] = h[6] &+ g
        h[7] = h[7] &+ hh
    }
}

public enum SHA256: Sendable {
    /// One-shot hex digest (NIST-vector tested).
    public static func hexDigest(_ data: Data) -> String {
        var hasher = SHA256Hasher()
        hasher.update(data)
        return hasher.finalized().map { String(format: "%02x", $0) }.joined()
    }

    /// Stream-verify a file against its manifest `sha256` (128 KiB chunks,
    /// so multi-GB model files never sit fully in memory).
    /// - Throws: `AppError.store` on I/O failure, `AppError` with code
    ///   `"model-checksum-mismatch"` on digest mismatch (caller deletes the
    ///   corrupt file, mirroring `downloader.rs`).
    public static func verify(fileURL: URL, expectedHex: String) throws {
        let normalized = expectedHex.lowercased()
        guard normalized.count == 64, normalized.allSatisfy({ $0.isHexDigit }) else {
            throw AppError.internal("malformed sha256 expectation")
        }
        let handle: FileHandle
        do {
            handle = try FileHandle(forReadingFrom: fileURL)
        } catch {
            throw AppError.store("cannot open file for verify: \(fileURL.lastPathComponent)")
        }
        defer { try? handle.close() }
        var hasher = SHA256Hasher()
        while true {
            let chunk: Data
            do {
                chunk = try handle.read(upToCount: 128 * 1024) ?? Data()
            } catch {
                throw AppError.store("cannot read file for verify: \(fileURL.lastPathComponent)")
            }
            if chunk.isEmpty { break }
            hasher.update(chunk)
        }
        let actual = hasher.finalized().map { String(format: "%02x", $0) }.joined()
        guard actual == normalized else {
            throw AppError.modelChecksumMismatch("checksum mismatch for \(fileURL.lastPathComponent)")
        }
    }
}
