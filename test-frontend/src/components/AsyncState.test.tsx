import { fireEvent, render, screen } from "@testing-library/react";

import { AsyncState } from "./AsyncState";

describe("AsyncState", () => {
  it("loading durumunu erişilebilir gösterir", () => {
    render(<AsyncState loading error={null}>veri</AsyncState>);
    expect(screen.getByText("Yükleniyor…").parentElement).toHaveAttribute("aria-busy", "true");
  });

  it("hata ve retry eylemini gösterir", () => {
    const retry = vi.fn();
    render(<AsyncState loading={false} error={new Error("bağlantı kesildi")} retry={retry}>veri</AsyncState>);
    expect(screen.getByRole("alert")).toHaveTextContent("bağlantı kesildi");
    fireEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("empty veya content branch'ini doğru seçer", () => {
    const { rerender } = render(<AsyncState loading={false} error={null} empty emptyMessage="Kuyruk boş">veri</AsyncState>);
    expect(screen.getByText("Kuyruk boş")).toBeInTheDocument();
    rerender(<AsyncState loading={false} error={null}>veri</AsyncState>);
    expect(screen.getByText("veri")).toBeInTheDocument();
  });
});

