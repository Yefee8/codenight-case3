from __future__ import annotations

from types import SimpleNamespace

from app import cli


def settings(tmp_path):
    return SimpleNamespace(
        synthetic_data_path=tmp_path / "dataset.csv",
        model_artifact_path=tmp_path / "model.joblib",
        model_manifest_path=tmp_path / "manifest.json",
        model_seed=2026,
    )


def test_generate_command_creates_only_dataset(monkeypatch, tmp_path) -> None:
    value = settings(tmp_path)
    calls: list[str] = []
    monkeypatch.setattr(cli, "get_settings", lambda: value)
    monkeypatch.setattr(cli, "generate_dataset", lambda *_, **__: calls.append("generate"))
    monkeypatch.setattr(cli, "train_and_package", lambda *_, **__: calls.append("train"))
    monkeypatch.setattr("sys.argv", ["fraudcell-ai", "generate", "--rows", "10000"])

    cli.main()
    assert calls == ["generate"]


def test_train_generates_missing_dataset_then_packages(monkeypatch, tmp_path) -> None:
    value = settings(tmp_path)
    calls: list[str] = []
    monkeypatch.setattr(cli, "get_settings", lambda: value)
    monkeypatch.setattr(cli, "generate_dataset", lambda *_, **__: calls.append("generate"))
    monkeypatch.setattr(cli, "train_and_package", lambda *_, **__: calls.append("train"))
    monkeypatch.setattr("sys.argv", ["fraudcell-ai", "train"])

    cli.main()
    assert calls == ["generate", "train"]


def test_ensure_model_keeps_compatible_artifact_and_retrains_incompatible_one(
    monkeypatch, tmp_path
) -> None:
    value = settings(tmp_path)
    value.synthetic_data_path.write_text("existing", "utf-8")
    value.model_artifact_path.write_text("artifact", "utf-8")
    value.model_manifest_path.write_text("manifest", "utf-8")
    calls: list[str] = []
    monkeypatch.setattr(cli, "get_settings", lambda: value)
    monkeypatch.setattr(cli, "train_and_package", lambda *_, **__: calls.append("train"))
    monkeypatch.setattr("sys.argv", ["fraudcell-ai", "ensure-model"])

    class Compatible:
        ready = True

        def __init__(self, *_):
            pass

        def load(self) -> None:
            pass

    monkeypatch.setattr(cli, "ModelBundle", Compatible)
    cli.main()
    assert calls == []

    class Incompatible(Compatible):
        ready = False

    monkeypatch.setattr(cli, "ModelBundle", Incompatible)
    cli.main()
    assert calls == ["train"]
