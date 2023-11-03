const DefaultMenu = () => {
  const Template = () => {
    return <div></div>;
  };

  return (
    <div className="p-2">
      <div className="flex flex-col items-center justify-center">
        <img
          className="h-full w-full p-6"
          src="https://airtable.com/images/workflows/Automations.png"
          alt="automation"
        />
        <span className="pt-2 text-center text-sm">
          Let Teable do the work for you by automating your most common tasks. Learn More
        </span>
      </div>
      <div>
        <Template></Template>
      </div>
    </div>
  );
};

export { DefaultMenu };
