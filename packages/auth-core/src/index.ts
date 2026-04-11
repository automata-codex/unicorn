// TODO(M2): Decide whether AuthService stays in this package or moves into
// apps/zoltar-be/src/services/interfaces/ alongside the six other deferred
// service interfaces (Entitlements, Metering, Email, AssetStorage, Realtime,
// FeatureFlag) that were stubbed in M1 Phase 5. The current split is
// inconsistent — the rationale for `auth-core` being a package is so a future
// closed-source SaaS package can import the abstract class, but the same
// rationale applies to the other six. Resolve this before implementing
// AuthJsService for real, since the decision affects where new files land.
interface AuthService {}

type User = {};
