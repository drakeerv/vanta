import { createSignal, onMount, Show } from "solid-js";
import { fetchStatus, type Status } from "./api";
import Setup from "./pages/Setup";
import Unlock from "./pages/Unlock";
import Vault from "./pages/Vault";
import Reels from "./pages/Reels";

export type Page = "vault" | "reels";

export default function App() {
  const [status, setStatus] = createSignal<Status | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [page, setPage] = createSignal<Page>("vault");

  const checkStatus = async () => {
    setLoading(true);
    try {
      setStatus(await fetchStatus());
    } catch {
      setStatus(null);
    }
    setLoading(false);
  };

  onMount(checkStatus);

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-950 antialiased">
      <Show
        when={!loading()}
        fallback={
          <div class="flex items-center justify-center min-h-screen text-gray-400">
            Loading…
          </div>
        }
      >
        <Show when={status()} fallback={
          <div class="flex items-center justify-center min-h-screen text-red-400">
            Failed to connect to server.
          </div>
        }>
          {(s) => (
            <>
              <Show when={!s().initialized}>
                <Setup onComplete={checkStatus} />
              </Show>
              <Show when={s().initialized && (!s().unlocked || !s().authenticated)}>
                <Unlock unlocked={s().unlocked} onComplete={checkStatus} />
              </Show>
              <Show when={s().initialized && s().unlocked && s().authenticated}>
                <Show when={page() === "vault"}>
                  <Vault onStatusChange={checkStatus} onNavigate={setPage} />
                </Show>
                <Show when={page() === "reels"}>
                  <Reels onBack={() => setPage("vault")} onStatusChange={checkStatus} />
                </Show>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
