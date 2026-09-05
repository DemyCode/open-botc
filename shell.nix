# Plain-nix fallback for people not using flakes:  nix-shell
{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_24
    chromium # only needed for `npm run ui-check`
  ];

  CHROME_BIN = "${pkgs.chromium}/bin/chromium";

  shellHook = ''
    echo "open-botc dev shell — node $(node --version)"
    echo "  npm install && npm run build && npm start"
  '';
}
