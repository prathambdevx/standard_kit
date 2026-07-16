import { Img } from '@/components/ui/img';
import { Picture } from '@/components/ui/picture';
import { Vid } from '@/components/ui/video';
import { isVideoUrl } from '@/utils/helpers';

type MediaFile = {
  url: string;
  alternativeText?: string | null;
  width?: number | null;
  height?: number | null;
};
type MediaData =
  | { desktop?: MediaFile | null; mobile?: MediaFile | null }
  | MediaFile
  | null
  | undefined;

// A plain CMS `media` field resolves to a bare UploadFile (has `url`); `elements.media` resolves to { desktop, mobile }.
const isSingleFile = (data: NonNullable<MediaData>): data is MediaFile => 'url' in data;

type Props = {
  data: MediaData;
  className?: string;
  sizes?: string;
  priority?: boolean;
  /** Fallback desktop dimensions when CMS doesn't provide them */
  fallbackWidth?: number;
  fallbackHeight?: number;
  /** Fallback mobile width — defaults to 390 (standard mobile viewport) */
  fallbackMobileWidth?: number;
  /** Render videos with play/mute controls instead of a silent background autoplay clip. */
  interactive?: boolean;
  /** Coordination group — only one interactive video in the same group plays at a time. */
  videoGroup?: string;
  /** Autoplay the video on mount (interactive videos default to paused unless set). */
  autoPlay?: boolean;
  /** Control layout for interactive videos — `bar` is the PDP bottom control bar. */
  videoControlsLayout?: 'overlay' | 'bar';
};

/** Renders a CMS `elements.media` field or a plain single-file `media` field — video when the URL is .mp4/.webm/.ogg/.mov, Picture otherwise. */
export const Media = ({
  data,
  className,
  sizes = '100vw',
  priority = false,
  fallbackWidth = 1440,
  fallbackHeight = 800,
  fallbackMobileWidth = 390,
  interactive = false,
  videoGroup,
  autoPlay = true,
  videoControlsLayout = 'overlay',
}: Props) => {
  const single = data && isSingleFile(data) ? data : undefined;
  const desktop = single ?? (data && !isSingleFile(data) ? data.desktop : undefined);
  const rawMobile = single ?? (data && !isSingleFile(data) ? data.mobile : undefined);
  const mobile = rawMobile ?? desktop;
  // A media relation can survive its asset being deleted in the CMS → object present, url null.
  if (!desktop?.url) return null;

  const renderImage = (file: MediaFile, fallbackW = fallbackWidth) => (
    <Img
      src={file.url}
      alt={file.alternativeText ?? ''}
      width={file.width ?? fallbackW}
      height={file.height ?? fallbackHeight}
      priority={priority}
      sizes={sizes}
      className={className}
    />
  );

  const renderVideo = (file: MediaFile, mobileVideoSrc?: string) => (
    <Vid
      src={file.url}
      mobileSrc={mobileVideoSrc}
      label={file.alternativeText ?? ''}
      className={className}
      group={videoGroup}
      autoPlay={autoPlay}
      controls={interactive || videoControlsLayout === 'bar'}
      controlsLayout={videoControlsLayout}
    />
  );

  const desktopIsVideo = isVideoUrl(desktop.url);
  const mobileIsVideo = rawMobile?.url ? isVideoUrl(rawMobile.url) : desktopIsVideo;

  // Mixed types (e.g. desktop video + mobile image) — a single <picture>/<video> can't swap
  // between an image and a video source, so render both and toggle by breakpoint (lg = 1024px).
  if (rawMobile?.url && rawMobile.url !== desktop.url && desktopIsVideo !== mobileIsVideo) {
    return (
      <>
        <div className="hidden h-full w-full lg:block">
          {desktopIsVideo ? renderVideo(desktop) : renderImage(desktop)}
        </div>
        <div className="h-full w-full lg:hidden">
          {mobileIsVideo ? renderVideo(rawMobile) : renderImage(rawMobile, fallbackMobileWidth)}
        </div>
      </>
    );
  }

  if (desktopIsVideo) {
    // Same-type pair only — a distinct mobile video swaps in via matchMedia inside Vid.
    const mobileVideoSrc =
      mobileIsVideo && rawMobile?.url !== desktop.url ? rawMobile?.url : undefined;
    return renderVideo(desktop, mobileVideoSrc);
  }

  // A single-file field has no distinct mobile source — render it with Img's one srcSet
  // instead of Picture's two identical <source> entries.
  if (single) return renderImage(single);

  return (
    <Picture
      mobileSrc={mobile?.url ?? ''}
      desktopSrc={desktop.url}
      alt={desktop.alternativeText ?? ''}
      mobileWidth={mobile?.width ?? fallbackMobileWidth}
      mobileHeight={mobile?.height ?? fallbackHeight}
      desktopWidth={desktop.width ?? fallbackWidth}
      desktopHeight={desktop.height ?? fallbackHeight}
      priority={priority}
      sizes={sizes}
      className={className}
    />
  );
};
