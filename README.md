# StereoView Deluxe

A stereoscopic photo viewer for VR headsets and 3D viewing devices.

## Features

- Side-by-side stereoscopic image display
- Touch gestures: pinch zoom, pan, swipe navigation
- Fullscreen mode with landscape orientation lock
- Password-protected gallery access

## Tech Stack

- React + TypeScript
- Vite
- Tailwind CSS
- shadcn-ui

## Getting Started

```sh
# Install dependencies
npm install

# Start development server
npm run dev
```

The dev server runs on port 8080.

## Adding Photos

Update `src/data/photos.ts` with your image sources. You can keep local files under
`public/photos/` or use a Dropbox shared folder link (no API token required).

To use Dropbox shared folder links:

1. Create a shared folder link in Dropbox (e.g., `https://www.dropbox.com/sh/<id>/<token>?dl=0`).
2. Set the environment variable `VITE_DROPBOX_FOLDER_SHARE_URL` to that link.
3. Add file names to the `dropboxPhotos` list in `src/data/photos.ts`.

The app will convert each file name into a direct `?raw=1` URL at runtime.

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Production build
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run test` - Run tests
