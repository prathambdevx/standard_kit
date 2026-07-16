'use client';

import { useEffect, useRef, useState } from 'react';
import { PlayIcon } from '@/assets/icons/play_icon';
import { VideoMuteIcon } from '@/assets/icons/video_mute_icon';
import { VideoPauseIcon } from '@/assets/icons/video_pause_icon';
import { VideoPlayIcon } from '@/assets/icons/video_play_icon';
import { VideoUnmuteIcon } from '@/assets/icons/video_unmute_icon';
import { VolumeOffIcon } from '@/assets/icons/volume_off_icon';
import { VolumeOnIcon } from '@/assets/icons/volume_on_icon';
import { cn } from '@/lib/cn';

type VidProps = {
  src: string;
  /** Optional mobile-specific source; falls back to `src` when omitted. */
  mobileSrc?: string;
  poster?: string;
  label?: string;
  className?: string;
  preload?: 'none' | 'metadata' | 'auto';
  initialMuted?: boolean;
  autoPlay?: boolean;
  group?: string;
  playIconClassName?: string;
  muteButtonClassName?: string;
  /** Chromeless background clip — hide the play/pause overlay and mute toggle. */
  controls?: boolean;
  /**
   * `overlay` (default) — centered play button + top-right mute toggle.
   * `bar` — bottom control bar (play/pause bottom-left, mute bottom-right over a gradient), matching the PDP media design.
   */
  controlsLayout?: 'overlay' | 'bar';
};

// Tracks the single currently-playing video per coordination group so only one plays at a time
const playingByGroup = new Map<string, HTMLVideoElement>();

/** Autoplaying, looped editorial video with a mute/unmute toggle. Pass `group` to keep only one video in that group playing at a time; `controlsLayout="bar"` for the PDP-style bottom control bar. */
export const Vid = ({
  src,
  mobileSrc,
  poster,
  label,
  className = '',
  preload = 'none',
  initialMuted = true,
  autoPlay = true,
  group,
  playIconClassName = 'h-9 w-9',
  muteButtonClassName = 'absolute right-2 top-2 flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-opacity hover:bg-black/60',
  controls = true,
  controlsLayout = 'overlay',
}: VidProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(initialMuted);
  const [playing, setPlaying] = useState(autoPlay);

  // `<source media>` is not reliably re-evaluated inside <video> (unlike <picture>), so pick the
  // source in JS. SSR renders desktop; mobile viewports swap after mount.
  const hasMobileSource = !!mobileSrc && mobileSrc !== src;
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (!hasMobileSource) return;
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [hasMobileSource]);
  const activeSrc = isMobile && mobileSrc ? mobileSrc : src;

  // React's `muted` prop doesn't always reflect to the DOM attribute, which
  // blocks muted autoplay. Force the property and attempt play() on mount; a
  // rejection (e.g. iOS Low Power Mode disallows autoplay) is harmless — the
  // first frame stays and the native play button is hidden in globals.css.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !autoPlay) return;
    v.muted = initialMuted;
    v.play().catch(() => {});
  }, [autoPlay, initialMuted]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  // Pause the group's previously-playing video so only this one runs
  const handlePlay = () => {
    setPlaying(true);
    if (!group) return;
    const current = playingByGroup.get(group);
    if (current && current !== videoRef.current) current.pause();
    if (videoRef.current) playingByGroup.set(group, videoRef.current);
  };

  const handlePause = () => {
    setPlaying(false);
    if (group && playingByGroup.get(group) === videoRef.current) playingByGroup.delete(group);
  };

  // Paused videos need a frame to show — without a poster, load metadata and
  // pin a first-frame fragment so the still renders instead of blank space
  const resolvedPreload = autoPlay ? preload : poster ? preload : 'metadata';
  const withFirstFrame = (s: string) =>
    autoPlay || poster ? s : `${s}${s.includes('#') ? '' : '#t=0.1'}`;

  return (
    <div className="group relative h-full w-full">
      {/* keyed by source so switching mobile/desktop remounts and reloads the <video> */}
      <video
        key={activeSrc}
        ref={videoRef}
        className={cn('h-full w-full object-cover', className)}
        poster={poster}
        aria-label={label}
        autoPlay={autoPlay}
        loop
        muted={initialMuted}
        playsInline
        preload={resolvedPreload}
        onPlay={handlePlay}
        onPause={handlePause}
        src={withFirstFrame(activeSrc)}
      />

      {controls && controlsLayout === 'overlay' && (
        <>
          {/* Play/pause — full overlay, shows icon only when paused */}
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pause video' : 'Play video'}
            className="absolute inset-0 flex cursor-pointer items-center justify-center"
          >
            {!playing && <PlayIcon className={playIconClassName} />}
          </button>

          {/* Mute/unmute — top-right */}
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute video' : 'Mute video'}
            className={muteButtonClassName}
          >
            {muted ? <VolumeOffIcon /> : <VolumeOnIcon />}
          </button>
        </>
      )}

      {controls && controlsLayout === 'bar' && (
        <>
          {/* Full-area play/pause toggle — gradient darkens only the bottom band (from 80%); play/pause icon sits bottom-left */}
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pause video' : 'Play video'}
            className="absolute inset-0 flex cursor-pointer items-end justify-start bg-gradient-to-b from-transparent from-80% to-black/50 fl-px-[12,24] fl-pb-[12,24] text-white"
          >
            {playing ? (
              <VideoPauseIcon className="fl-size-[24,32]" />
            ) : (
              <VideoPlayIcon className="fl-size-[24,32]" />
            )}
          </button>

          {/* Mute/unmute — bottom-right, layered above the toggle so it stays independent */}
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute video' : 'Mute video'}
            className="absolute fl-right-[12,24] fl-bottom-[12,24] flex cursor-pointer items-center justify-center text-white"
          >
            {muted ? (
              <VideoMuteIcon className="fl-size-[24,32]" />
            ) : (
              <VideoUnmuteIcon className="fl-size-[24,32]" />
            )}
          </button>
        </>
      )}
    </div>
  );
};
