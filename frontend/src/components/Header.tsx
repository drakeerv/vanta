import { Button } from "./ui/Button";
import { Dropdown, type MenuItem } from "./ui/Dropdown";
import { Clapperboard } from "lucide-solid";
import * as api from "../api";
import type { Page } from "../App";

export function Header(props: {
  onUpload: () => void;
  onBulkTag: () => void;
  onRenameTag: () => void;
  onStatusChange: () => void;
  onNavigate: (page: Page) => void;
}) {
  const handleLogout = async () => {
    await api.logout();
    props.onStatusChange();
  };

  const handleLock = async () => {
    await api.lockVault();
    props.onStatusChange();
  };

  const toolItems: MenuItem[] = [
    { label: "Bulk Tag", onClick: props.onBulkTag },
    { label: "Rename Tag", onClick: props.onRenameTag },
  ];

  const mobileItems: MenuItem[] = [
    { label: "Upload", onClick: props.onUpload },
    { label: "Reels", onClick: () => props.onNavigate("reels") },
    { label: "Bulk Tag", onClick: props.onBulkTag },
    { label: "Rename Tag", onClick: props.onRenameTag },
    { label: "Logout", onClick: handleLogout },
    { label: "Lock Vault", onClick: handleLock },
  ];

  return (
    <header class="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 sticky top-0 z-20">
      <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <h1 class="text-xl font-bold tracking-tight">VANTA</h1>

        {/* Desktop nav */}
        <nav class="hidden md:flex items-center gap-2">
          <Button variant="ghost" onClick={props.onUpload}>
            +
          </Button>
          <Button variant="ghost" onClick={() => props.onNavigate("reels")}>
            <Clapperboard size={16} />
            <span class="ml-1">Reels</span>
          </Button>
          <Dropdown trigger={<>Tools ▾</>} items={toolItems} />
          <Button variant="ghost" onClick={handleLogout}>Logout</Button>
          <Button onClick={handleLock}>Lock</Button>
        </nav>

        {/* Mobile nav — Kobalte DropdownMenu */}
        <div class="md:hidden">
          <Dropdown
            trigger={
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            }
            items={mobileItems}
          />
        </div>
      </div>
    </header>
  );
}
