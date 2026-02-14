import {
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  Index,
  For,
  Show,
} from "solid-js";
import * as api from "../api";
import type { ImageEntry } from "../api";
import { createVaultStore } from "../lib/store";
import { Suggestions } from "../components/ui/Suggestions";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { TagModal } from "../components/TagModal";
import { InfoModal } from "../components/InfoModal";
import {
  Tag,
  Info,
  Search,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-solid";

type ModalType = "tag" | "info" | null;

/**
 * A single "slide" in the vertical feed.
 * For linked sets it shows a horizontally-swipeable sub-carousel.
 */
function ReelSlide(props: {
  entry: ImageEntry;
  active: boolean;
  onTag: () => void;
  onInfo: () => void;
}) {
  const [subIndex, setSubIndex] = createSignal(0);

  // Build the list of image URLs for this entry (cover + linked)
  const slides = () => {
    const list: { src: string; thumb: string }[] = [
      {
        src: api.highResUrl(props.entry.id),
        thumb: api.thumbnailUrl(props.entry.id),
      },
    ];
    for (const linked of props.entry.linked_images ?? []) {
      list.push({
        src: api.linkedHighResUrl(props.entry.id, linked.id),
        thumb: api.linkedThumbnailUrl(props.entry.id, linked.id),
      });
    }
    return list;
  };

  const isSet = () => slides().length > 1;
  const goNext = () =>
    setSubIndex((i) => Math.min(slides().length - 1, i + 1));
  const goPrev = () => setSubIndex((i) => Math.max(0, i - 1));

  // Reset sub-index when the entry changes
  createEffect(() => {
    props.entry.id;
    setSubIndex(0);
  });

  // Touch handling for horizontal swipe within linked set
  let touchStartX = 0;
  const onTouchStart = (e: TouchEvent) => {
    touchStartX = e.touches[0].clientX;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) {
      if (dx < 0) goNext();
      else goPrev();
    }
  };

  return (
    <div class="relative w-full h-full flex items-center justify-center bg-black select-none snap-start snap-always">
      {/* Image */}
      <div
        class="absolute inset-0 flex items-center justify-center"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <img
          src={slides()[subIndex()]?.src ?? ""}
          alt=""
          class="w-full h-full object-contain"
          draggable={false}
        />
      </div>

      {/* Linked-set arrows (desktop) */}
      <Show when={isSet()}>
        <button
          class={`absolute left-3 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-white/20 transition-all cursor-pointer ${subIndex() === 0 ? "opacity-0 pointer-events-none" : ""}`}
          onClick={goPrev}
        >
          <ChevronLeft size={22} />
        </button>
        <button
          class={`absolute right-3 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-white/20 transition-all cursor-pointer ${subIndex() >= slides().length - 1 ? "opacity-0 pointer-events-none" : ""}`}
          onClick={goNext}
        >
          <ChevronRight size={22} />
        </button>
      </Show>

      {/* Linked-set dots */}
      <Show when={isSet()}>
        <div class="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex gap-1.5">
          <For each={slides()}>
            {(_, i) => (
              <button
                class={`w-2 h-2 rounded-full transition-all cursor-pointer ${
                  i() === subIndex()
                    ? "bg-white scale-110"
                    : "bg-white/40 hover:bg-white/60"
                }`}
                onClick={() => setSubIndex(i())}
              />
            )}
          </For>
        </div>
      </Show>

      {/* Bottom overlay — tags + actions */}
      <div class="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
        <div class="bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-16 pb-6 px-5 pointer-events-auto">
          {/* Tags */}
          <div class="flex gap-1.5 flex-wrap mb-3">
            <For each={props.entry.tags.slice(0, 3)}>
              {(tag) => (
                <span class="px-2 py-0.5 bg-white/15 backdrop-blur-sm text-white rounded text-[10px] uppercase tracking-wider flex items-center gap-1">
                  <Tag size={10} /> {tag}
                </span>
              )}
            </For>
            <Show when={props.entry.tags.length > 3}>
              <button
                onClick={props.onTag}
                class="px-2 py-0.5 bg-white/10 backdrop-blur-sm text-white/70 rounded text-[10px] uppercase tracking-wider hover:bg-white/20 cursor-pointer"
              >
                +{props.entry.tags.length - 3} more
              </button>
            </Show>
            <Show when={props.entry.tags.length === 0}>
              <span class="text-xs text-white/40 italic">No tags</span>
            </Show>
          </div>

          {/* Actions row */}
          <div class="flex gap-2">
            <button
              class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/15 backdrop-blur-sm text-white rounded-lg text-xs hover:bg-white/25 transition-colors cursor-pointer"
              onClick={props.onTag}
            >
              <Tag size={14} />
              Tags
            </button>
            <button
              class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/15 backdrop-blur-sm text-white rounded-lg text-xs hover:bg-white/25 transition-colors cursor-pointer"
              onClick={props.onInfo}
            >
              <Info size={14} />
              Info
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Reels(props: {
  onBack: () => void;
  onStatusChange: () => void;
}) {
  const store = createVaultStore(props.onStatusChange);

  const [searchInput, setSearchInput] = createSignal("");
  const [searchFocused, setSearchFocused] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(true);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [modal, setModal] = createSignal<ModalType>(null);
  const [loaded, setLoaded] = createSignal(false);

  // Shuffled feed (separate from store.images so tags still update in-place)
  const [feed, setFeed] = createSignal<ImageEntry[]>([]);

  let feedRef: HTMLDivElement | undefined;

  // Init
  onMount(() => {
    store.loadTags();
  });

  const activeImage = () => feed()[activeIndex()] ?? null;

  // Fisher-Yates shuffle
  function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // When store.images() gets updated (e.g. tag change), mirror into feed keeping same order
  createEffect(() => {
    const imgs = store.images();
    setFeed((prev) => {
      if (prev.length === 0) return prev; // initial load handled by doSearch/startBrowsing
      // Update entries in-place by id map
      const byId = new Map(imgs.map((e) => [e.id, e]));
      return prev.map((old) => byId.get(old.id) ?? old);
    });
  });

  // Load feed
  const doSearch = () => {
    const q = searchInput().trim() || undefined;
    store.loadImages(q).then(() => {
      setFeed(shuffle(store.images()));
      setLoaded(true);
      setSearchOpen(false);
      setActiveIndex(0);
      if (feedRef) feedRef.scrollTo({ top: 0 });
    });
  };

  // Browse all
  const startBrowsing = () => {
    store.loadImages().then(() => {
      setFeed(shuffle(store.images()));
      setLoaded(true);
      setSearchOpen(false);
      setActiveIndex(0);
    });
  };

  // ── Scroll tracking via IntersectionObserver ──
  let observer: IntersectionObserver | undefined;

  const setupObserver = () => {
    if (observer) observer.disconnect();
    if (!feedRef) return;

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const idx = Number(
              (entry.target as HTMLElement).dataset.index ?? 0
            );
            setActiveIndex(idx);
          }
        }
      },
      {
        root: feedRef,
        threshold: 0.5,
      }
    );

    for (const child of feedRef.children) {
      observer.observe(child);
    }
  };

  // Re-attach observer when feed or loaded changes
  createEffect(() => {
    feed(); // track
    loaded(); // track
    // Wait for DOM to be in sync
    requestAnimationFrame(setupObserver);
  });

  onCleanup(() => observer?.disconnect());

  // ── Desktop mouse drag to scroll vertically ──
  const [isDragging, setIsDragging] = createSignal(false);
  const [disableSnap, setDisableSnap] = createSignal(false);
  
  let dragStartY = 0;
  let dragStartScroll = 0;
  let snapTimeout: number | undefined;

  const onMouseDown = (e: MouseEvent) => {
    // Only left-click
    if (e.button !== 0) return;
    // Don't drag if clicking interactive elements
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    
    // Clear any pending snap-reenable timer so we don't snap mid-drag
    clearTimeout(snapTimeout);
    
    setDisableSnap(true);
    setIsDragging(true);
    dragStartY = e.clientY;
    dragStartScroll = feedRef?.scrollTop ?? 0;
    e.preventDefault();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging() || !feedRef) return;
    const dy = e.clientY - dragStartY;
    feedRef.scrollTop = dragStartScroll - dy;
  };

  const onMouseUp = (e: MouseEvent) => {
    if (!isDragging() || !feedRef) return;
    
    setIsDragging(false);
    
    // Snap to nearest slide manually with smooth scroll
    const slideH = feedRef.clientHeight;
    const nearest = Math.round(feedRef.scrollTop / slideH) * slideH;
    feedRef.scrollTo({ top: nearest, behavior: "smooth" });

    // Re-enable CSS snap AFTER the animation finishes (approx 500ms)
    // This prevents the browser's native snap from overriding our smooth scroll
    snapTimeout = window.setTimeout(() => {
      setDisableSnap(false);
    }, 500);
  };

  // Keyboard: Escape closes modals, then opens search
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (modal()) {
        setModal(null);
      } else if (!searchOpen()) {
        setSearchOpen(true);
      } else {
        props.onBack();
      }
    }
  };
  onMount(() => document.addEventListener("keydown", onKeyDown));
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  // Lock body scroll
  onMount(() => {
    document.body.style.overflow = "hidden";
  });
  onCleanup(() => {
    document.body.style.overflow = "";
  });

  return (
    <div class="fixed inset-0 z-30 bg-black flex flex-col">
      {/* ── Top bar ── */}
      <div
        class={`absolute top-0 left-0 right-0 z-20 transition-all duration-300 ${
          searchOpen()
            ? "bg-black/80 backdrop-blur-md"
            : "bg-transparent pointer-events-none"
        }`}
      >
        <div class="flex items-center gap-2 p-3 pointer-events-auto">
          {/* Back button */}
          <button
            class="p-2 text-white/70 hover:text-white rounded-full hover:bg-white/10 transition-colors cursor-pointer flex-shrink-0"
            onClick={props.onBack}
            title="Back to gallery"
          >
            <ArrowLeft size={20} />
          </button>

          {/* Search toggle or search bar */}
          <Show
            when={searchOpen()}
            fallback={
              <button
                class="p-2 text-white/70 hover:text-white rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                onClick={() => setSearchOpen(true)}
                title="Search"
              >
                <Search size={20} />
              </button>
            }
          >
            <div class="flex-1 flex gap-2 items-center">
              <div class="relative flex-1">
                <Input
                  placeholder="Search tags… (leave empty for all)"
                  value={searchInput()}
                  onChange={setSearchInput}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() =>
                    setTimeout(() => setSearchFocused(false), 150)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      doSearch();
                      setSearchFocused(false);
                    }
                    if (e.key === "Escape") {
                      if (loaded()) {
                        setSearchOpen(false);
                      }
                    }
                  }}
                  class="[&_input]:!bg-white/10 [&_input]:!border-white/10 [&_input]:!text-white [&_input]:!placeholder-white/40"
                />
                <Suggestions
                  input={searchInput()}
                  tags={store.tags()}
                  visible={searchFocused()}
                  onSelect={setSearchInput}
                />
              </div>
              <Button onClick={doSearch}>Go</Button>
              <Show when={loaded()}>
                <button
                  class="p-2 text-white/50 hover:text-white rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                  onClick={() => setSearchOpen(false)}
                >
                  <X size={18} />
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      {/* ── Welcome / empty states ── */}
      <Show when={!loaded()}>
        <div class="flex-1 flex flex-col items-center justify-center text-white/60 gap-4 px-6">
          <h2 class="text-2xl font-bold text-white/80 tracking-tight">
            Reels
          </h2>
          <p class="text-sm text-center max-w-xs">
            Search by tags or browse all images in an immersive feed.
          </p>
          <div class="flex gap-3 mt-2">
            <Button onClick={startBrowsing}>Browse All</Button>
            <Button
              variant="secondary"
              onClick={() => setSearchOpen(true)}
              class="!text-white/70"
            >
              Search
            </Button>
          </div>
        </div>
      </Show>

      <Show when={loaded() && feed().length === 0}>
        <div class="flex-1 flex flex-col items-center justify-center text-white/60 gap-4 px-6">
          <p class="text-sm">No images match your search.</p>
          <Button
            variant="secondary"
            onClick={() => setSearchOpen(true)}
            class="!text-white/70"
          >
            Try Again
          </Button>
        </div>
      </Show>

      {/* ── Feed ── */}
      <Show when={loaded() && feed().length > 0}>
        <div
          ref={feedRef}
          class="flex-1 overflow-y-scroll snap-y snap-mandatory"
          style={{
            "scroll-snap-type": disableSnap() ? "none" : "y mandatory",
            "cursor": isDragging() ? "grabbing" : "grab",
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <Index each={feed()}>
            {(entry, i) => (
              <div
                class="w-full h-[100dvh] flex-shrink-0"
                data-index={i}
                style={{ "scroll-snap-align": "start" }}
              >
                <ReelSlide
                  entry={entry()}
                  active={activeIndex() === i}
                  onTag={() => setModal("tag")}
                  onInfo={() => setModal("info")}
                />
              </div>
            )}
          </Index>
        </div>
      </Show>

      {/* ── Modals ── */}
      <TagModal
        open={modal() === "tag"}
        onClose={() => setModal(null)}
        image={activeImage()}
        store={store}
      />
      <InfoModal
        open={modal() === "info"}
        onClose={() => setModal(null)}
        image={activeImage()}
      />
    </div>
  );
}