{
  description = "open-botc — self-hosted, storyteller-free Blood on the Clocktower (Trouble Brewing)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            # Only needed for `npm run ui-check`.
            chromium
          ];

          # ui-check looks here when --chrome is not given.
          CHROME_BIN = "${pkgs.chromium}/bin/chromium";

          shellHook = ''
            echo "open-botc dev shell — node $(node --version)"
            echo "  npm install && npm run build && npm start"
          '';
        };

        packages.default = pkgs.buildNpmPackage {
          pname = "open-botc";
          version = "0.1.0";
          src = ./.;

          # Regenerate after changing package-lock.json with:
          #   nix run nixpkgs#prefetch-npm-deps -- package-lock.json
          npmDepsHash = "sha256-ow6Imd647UpFi+m2oxMH0u66GOHGIMMdFHCEsmnNMbg=";

          buildPhase = ''
            runHook preBuild
            npm run build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out/lib/open-botc $out/bin
            cp -r dist public node_modules package.json $out/lib/open-botc/
            makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/open-botc \
              --add-flags $out/lib/open-botc/dist/index.js
            runHook postInstall
          '';

          nativeBuildInputs = [ pkgs.makeWrapper ];
        };
      });
}
