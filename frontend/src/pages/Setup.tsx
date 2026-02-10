import { createSignal, Show } from "solid-js";
import { setup } from "../api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

export default function Setup(props: { onComplete: () => void }) {
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await setup(password());
      props.onComplete();
    } catch (err: any) {
      setError(err.message || "Setup failed");
      setLoading(false);
    }
  };

  return (
    <div class="flex items-center justify-center min-h-screen p-4">
      <div class="w-full max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow-lg p-6">
        <h2 class="text-xl font-bold mb-1">Setup Vault</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Create a master password to secure your vault.
        </p>
        <form onSubmit={handleSubmit} class="flex flex-col gap-4">
          <Input
            label="Master Password"
            type="password"
            placeholder="Enter a strong password"
            value={password()}
            onChange={setPassword}
            required
          />
          <Button type="submit" disabled={loading()} class="w-full">
            {loading() ? "Initializing…" : "Initialize Vault"}
          </Button>
        </form>
        <Show when={error()}>
          <p class="mt-3 text-sm font-medium text-red-500">{error()}</p>
        </Show>
      </div>
    </div>
  );
}
