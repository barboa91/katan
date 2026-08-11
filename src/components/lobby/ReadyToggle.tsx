const ReadyToggle = ({
  ready,
  disabled,
  onToggle,
}: {
  ready: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) => {
  return (
    <button
      onClick={() => onToggle(!ready)}
      disabled={disabled}
      className={`rounded-md px-6 py-2 font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
        ready ? "bg-gray-500 hover:bg-gray-600" : "bg-green-600 hover:bg-green-700"
      }`}
    >
      {ready ? "Not ready" : "Ready up"}
    </button>
  );
};
export default ReadyToggle;
