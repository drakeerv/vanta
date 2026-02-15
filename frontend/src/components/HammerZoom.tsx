import { onMount, onCleanup, createEffect } from "solid-js";
import Hammer from "hammerjs";

interface Props {
  src: string;
  active: boolean;
  onZoomChange: (isZoomed: boolean) => void;
  onSwipeNext: () => void;
  onSwipePrev: () => void;
}

export function HammerZoom(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let imgRef: HTMLImageElement | undefined;

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let lastScale = 1;
  let lastX = 0;
  let lastY = 0;

  const updateTransform = (animate = false) => {
    if (!imgRef) return;
    imgRef.style.transition = animate ? "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)" : "none";
    imgRef.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
    props.onZoomChange(scale > 1.05);
  };

  const reset = (animate = true) => {
    scale = 1; translateX = 0; translateY = 0; lastScale = 1; lastX = 0; lastY = 0;
    updateTransform(animate);
  };

  createEffect(() => {
    if (!props.active) reset(false);
  });

  onMount(() => {
    if (!containerRef || !imgRef) return;
    const mc = new Hammer.Manager(containerRef);
    mc.add(new Hammer.Pan({ threshold: 10, direction: Hammer.DIRECTION_ALL }));
    mc.add(new Hammer.Pinch());
    mc.add(new Hammer.Tap({ taps: 2 }));
    mc.get('pinch').recognizeWith(mc.get('pan'));

    mc.on("panstart", () => { lastX = translateX; lastY = translateY; });
    mc.on("panmove", (e) => {
      if (scale <= 1.05) return;
      translateX = lastX + e.deltaX;
      translateY = lastY + e.deltaY;
      updateTransform();
    });
    mc.on("panend", (e) => {
      if (scale <= 1.05 && Math.abs(e.velocityX) > 0.3) {
        if (e.deltaX < -60) props.onSwipeNext();
        if (e.deltaX > 60) props.onSwipePrev();
      }
    });
    mc.on("pinchstart", () => { lastScale = scale; lastX = translateX; lastY = translateY; });
    mc.on("pinchmove", (e) => {
      scale = Math.max(1, Math.min(lastScale * e.scale, 6));
      const deltaScale = scale - lastScale;
      const focalX = e.center.x - containerRef!.offsetWidth / 2;
      const focalY = e.center.y - containerRef!.offsetHeight / 2;
      translateX = lastX - (focalX * deltaScale / lastScale);
      translateY = lastY - (focalY * deltaScale / lastScale);
      updateTransform();
    });
    mc.on("pinchend", () => { if (scale <= 1.1) reset(true); });
    mc.on("tap", (e) => {
      if (scale > 1.1) reset(true);
      else {
        scale = 2.5;
        const focalX = e.center.x - containerRef!.offsetWidth / 2;
        const focalY = e.center.y - containerRef!.offsetHeight / 2;
        translateX = -focalX * 1.5; translateY = -focalY * 1.5;
        updateTransform(true);
      }
    });
    onCleanup(() => mc.destroy());
  });

  return (
    <div ref={containerRef} class="w-full h-full flex items-center justify-center overflow-hidden touch-none select-none">
      <img ref={imgRef} src={props.src} alt="" class="max-w-[95%] max-h-[95%] object-contain will-change-transform" draggable={false} />
    </div>
  );
}