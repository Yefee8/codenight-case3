import { render, screen } from "@testing-library/react";

import { StatusBadge } from "./StatusBadge";

it("yalnız güvenli status class üretir", () => {
  const { rerender } = render(<StatusBadge value="KRITIK" />);
  expect(screen.getByText("KRITIK")).toHaveClass("status-kritik");

  rerender(<StatusBadge value={'x" onclick="alert(1)'} />);
  expect(screen.getByText("BELIRSIZ")).toHaveClass("status-belirsiz");
});

