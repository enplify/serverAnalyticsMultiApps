import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Projekt 1",
  description: "Projekt 1 Webapp"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
