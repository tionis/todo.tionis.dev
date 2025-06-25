# Smart Todos - Collaborative Todo Lists

A modern, collaborative todo list application built with Next.js and InstantDB. Features real-time collaboration, sublists/categories, flexible permissions, offline support, and PWA installability.

## Features

- **Real-time Collaboration**: Multiple users can work on the same todo list simultaneously
- **Sublists/Categories**: Organize todos with sublists for better structure
- **Flexible Permissions**: Public, private, or members-only lists with granular control
- **Invitation System**: Invite collaborators via email with role-based permissions
- **Offline Support**: Works offline with data synchronization when back online
- **PWA Support**: Installable as a native app on mobile and desktop
- **Dark Mode**: Toggle between light and dark themes (Ctrl+Shift+D)
- **Magic Link Authentication**: Secure, passwordless login system

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Icon Generation

When you update the main SVG icons, you can regenerate all the required PNG sizes for the PWA:

```bash
# Generate all icon sizes from public/icon.svg
npm run generate-icons

# Generate screenshot images from SVG screenshots
npm run generate-screenshots

# Generate both icons and screenshots
npm run generate-assets
```

The `generate-icons` script creates:
- App icons in sizes: 72x72, 96x96, 128x128, 144x144, 152x152, 192x192, 384x384, 512x512
- Apple touch icon: 180x180

## Scripts

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run generate-icons` - Generate PNG icons from SVG
- `npm run generate-screenshots` - Generate PNG screenshots from SVG
- `npm run generate-assets` - Generate all icons and screenshots

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Database**: InstantDB (real-time database with built-in auth)
- **Styling**: Tailwind CSS 4
- **PWA**: Service Worker, Web App Manifest
- **Deployment**: Vercel-ready

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [InstantDB Documentation](https://docs.instantdb.com/)
- [PWA Documentation](https://web.dev/progressive-web-apps/)

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme).

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
