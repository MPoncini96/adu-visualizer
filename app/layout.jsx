import "./globals.css";
import SiteNav from "../components/SiteNav.jsx";

export const metadata = {
  title: "Valley ADU Studio · See your ADU before you build",
  description: "Walk through ADU plans in 3D and place one on your own lot to check the fit. Serving Lodi to Fresno along Highway 99.",
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f3ec" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
