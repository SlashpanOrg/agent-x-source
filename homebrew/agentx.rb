# typed: false
# frozen_string_literal: true

class Agentx < Formula
  desc "AI-powered personal agent with terminal UI"
  homepage "https://github.com/SlashpanOrg/agent-x-source"
  license "MIT"
  version "0.1.4"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/SlashpanOrg/agent-x-releases/releases/download/v#{version}/agentx-darwin-arm64.tar.gz"
      sha256 "" # Updated by release workflow
    else
      url "https://github.com/SlashpanOrg/agent-x-releases/releases/download/v#{version}/agentx-darwin-x64.tar.gz"
      sha256 "" # Updated by release workflow
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/SlashpanOrg/agent-x-releases/releases/download/v#{version}/agentx-linux-arm64.tar.gz"
      sha256 "" # Updated by release workflow
    else
      url "https://github.com/SlashpanOrg/agent-x-releases/releases/download/v#{version}/agentx-linux-x64.tar.gz"
      sha256 "" # Updated by release workflow
    end
  end

  def install
    bin.install "agentx"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/agentx --version")
  end
end
