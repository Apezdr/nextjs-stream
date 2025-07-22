'use client';
import Link from 'next/link';
import Image from 'next/image';
import MediaPoster from '../../MediaPoster';
import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence';
import HD4kBanner from '../../../../public/4kBanner.png';
import hdr10PlusLogo from '../../../../public/HDR10+_Logo_light.svg';
import { classNames } from '@src/utils';
import RetryImage from '@components/RetryImage';

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
};

export default function SeasonItem({ season, showTitle }) {
  const { seasonNumber, has4k, hasHDR, hasHDR10, posterBlurhash } = season;

  return (
    <li className="relative min-w-[250px] ml-4 xl:ml-0">
      <PageContentAnimatePresence
        variants={variants}
        transition={{
          type: 'linear',
          duration: 0.45,
        }}
      >
        <Link href={`/list/tv/${showTitle}/${seasonNumber}`}>
          <div className="block mb-2 w-full lg:w-auto group">
            <MediaPoster
              className="max-w-[200px] !mx-auto rounded-t-sm shadow-2xl"
              contClassName="mx-auto"
              tv={season}
            />
            <button
              type="button"
              className="mx-auto w-full flex flex-col items-center gap-x-2 justify-center rounded-b bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-2xl group-hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 h-16 lg:h-auto max-w-[200px]"
            >
              <div className="my-2 text-center text-sm font-medium text-gray-200">
                <span>Season {seasonNumber}</span>
              </div>
              {/* Conditionally render the horizontal rule once if either has4k or hasHDR is true */}
              {(has4k || hasHDR) && <hr className="mb-2 border-gray-600/50 w-full" />}
              {/* Conditionally render the 4K and HDR images once */}
              {(has4k || hasHDR) && (
                <div className="flex flex-row gap-x-2">
                  {has4k && (
                    <div className="mb-2 select-none bg-transparent h-4">
                      <RetryImage
                        src={HD4kBanner}
                        className="h-auto w-[85px]"
                        alt="4K Banner"
                        loading="lazy"
                        placeholder="blur"
                      />
                    </div>
                  )}
                  {hasHDR && (
                    hasHDR10 ? (
                      <div className="mb-2 select-none bg-transparent h-4">
                        <RetryImage
                          src={hdr10PlusLogo}
                          alt="HDR10 Logo"
                          className="h-4 w-auto"
                          loading="lazy"
                        />
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </button>
          </div>
        </Link>
      </PageContentAnimatePresence>
    </li>
  );
}
