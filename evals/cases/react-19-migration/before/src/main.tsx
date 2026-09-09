import * as React from "react";
import ReactDOM from "react-dom";
import { GameShelf } from "@/components/library/GameShelf";

const container = document.getElementById("shelf-root");

if (container) {
  ReactDOM.render(<GameShelf userId={container.dataset.userId ?? ""} status="playing_now" />, container);
}
